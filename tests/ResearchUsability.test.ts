import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import compression from 'compression';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { material, state } from './fixtures';
import { listen } from './httpFixtures';
import { runActiveLearningStep } from '../src/engine/ActiveLearningLoop';
import { extendRandomComparison, comparisonSavings, samplingBudgetLimit, normalizeSamplingBudget } from '../src/engine/RandomComparison';
import { rankPreferredCandidates, preferredCandidate, type ParetoCandidate } from '../src/engine/pareto/ParetoEngine';
import { DEFAULT_HUB_QUERY, MAX_HUB_CANDIDATES, type HubRecord } from '../src/dataHub';
import { parseHubQuery } from '../server/hubStore';
import { createHubProjection } from '../server/hubProjection';
import { structureFingerprint } from '../src/structures/fingerprint';
import { normalizeMaterialStructure } from '../src/structures/materialStructure';
import { hydrateHubMaterials } from '../src/engine/MaterialsEngine';
import { captureSession, parseSession, restoreCandidatePool } from '../src/research/session';
import { emptyResearchModules } from '../src/research/types';
import { DEFAULT_MODEL_CONFIG } from '../src/engine/models/config';
import { productionAssets } from '../server/productionAssets';
import { AdvisorError, advisorErrorMessage } from '../src/services/AdvisorService';

const provenance = { reference:'Synthetic usability fixture', url:'https://fixtures.invalid/usability', datasetVersion:'test', retrievedAt:'2026-11-05T00:00:00Z', license:'test-only' };
const record = (i: number): HubRecord => ({ id:`mp-test${i}`, formula:'Li2O', composition:{Li:2,O:1}, source:'MP-DFT', fidelity:'low-dft', cohort:'test', methodMeta:'test', provenance,
  values:{'band-gap':i/100}, units:{'band-gap':'eV'}, revision:'a'.repeat(64) });
const metadata = { requestedSource:'mp-snapshot' as const, effectiveSource:'mp-snapshot' as const, objective:'band-gap' as const, query:DEFAULT_HUB_QUERY, total:1001, datasetVersion:'test', fetchedAt:provenance.retrievedAt, excludedMissingTarget:0 };

test('large candidate defaults reserve unobserved materials and stay within model training bounds', () => {
  assert.equal(DEFAULT_HUB_QUERY.limit,2000);assert.equal(MAX_HUB_CANDIDATES,5000);
  assert.equal(parseHubQuery({limit:'5000'}).limit,5000);assert.throws(()=>parseHubQuery({limit:'5001'}));
  assert.equal(samplingBudgetLimit(2000),200);assert.equal(samplingBudgetLimit(40),5);assert.equal(samplingBudgetLimit(1),0);
  assert.equal(normalizeSamplingBudget(50,40),5);
  assert.equal(normalizeSamplingBudget(50,40,40),40); // Keep historical observations when opening an older exhaustive run.
  assert.equal(normalizeSamplingBudget(500,5000),200);
  for(const n of [2,10,40,500,2000,5000])assert.ok(samplingBudgetLimit(n)<n);
});

test('uniform comparison shares initial IDs, ignores cost/prior, and aligns the final short batch', async () => {
  let pool=Array.from({length:100},(_,i)=>material(i)), current=state();
  const model={train(){},predictBatch(rows:unknown[]){return rows.map((_,i)=>({mean:i,std:.1}));}};
  for(let i=0;i<30;i++){
    const result=await runActiveLearningStep(pool,current,{totalBudget:50,batchSize:2,strategy:'UCB',random:()=>0,comparisonSeed:42},model);
    pool=result.pool;current=result.state;if(result.stopReason)break;
  }
  const c=current.comparison!;assert.deepEqual(c.initialIds,['test-0','test-1','test-2','test-3','test-4']);
  assert.deepEqual(c.points.map(p=>p.sampledCount),current.history.map(p=>p.sampledCount));assert.equal(c.points.at(-1)!.sampledCount,50);
  assert.ok(c.points.every(p=>new Set(p.sampledIds).size===p.sampledCount));
  const perturbed=pool.map(m=>({...m,cost:99999-(Number(m.id.split('-')[1])),acquisitionValue:-999}));
  assert.deepEqual(extendRandomComparison([],perturbed,c,42,'max').points.at(-1),c.points.at(-1));
  assert.equal(pool.filter(m=>m.isSampled).length,50);
});

test('matched-target savings retain negative results, missing attainment and minimization direction',()=>{
  const s=state({bestValue:10,history:[{iteration:1,sampledCount:5,bestValue:3,regret:7,avgError:0},{iteration:2,sampledCount:9,bestValue:10,regret:0,avgError:0}],
    comparison:{schema:'uniform-label-replay-1',seed:4,initialIds:[],points:[{sampledCount:5,bestValue:10,sampledIds:[]}]}});
  assert.equal(comparisonSavings(s,'max')!.saved,-4);
  s.comparison!.points[0].bestValue=8;assert.equal(comparisonSavings(s,'max')!.saved,null);
  s.bestValue=2;s.history[1].bestValue=2;s.comparison!.points[0].bestValue=1;assert.equal(comparisonSavings(s,'min')!.saved,-4);
});

test('property-only list projection preserves the exact geometry fingerprint and record revision', async()=>{
  const row=record(0);row.structure={lattice:{matrix:[[3,0,0],[0,3,0],[0,0,3]]},sites:[{species:[{element:'Li',occu:1}],abc:[0,0,0]},{species:[{element:'Li',occu:1}],abc:[.5,.5,0]},{species:[{element:'O',occu:1}],abc:[.5,0,.5]}]};
  const light=createHubProjection()(row,row.revision!);assert.equal(light.structure,undefined);assert.equal(light.hasStructure,true);
  const expected=await structureFingerprint(normalizeMaterialStructure({material_id:row.id,formula_pretty:row.formula,structure:row.structure},row.id,provenance.retrievedAt,true));
  assert.equal(light.structureHash,expected);assert.equal(light.revision,row.revision);
  const [hydrated]=await hydrateHubMaterials([light],metadata);assert.equal(hydrated.structureHash,expected);assert.equal(hydrated.structureRef?.revision,row.revision);
});

test('research restoration batches more than 500 exact references and honors cancellation',async()=>{
  const rows=Array.from({length:1001},(_,i)=>record(i)), pool=await hydrateHubMaterials(rows,metadata);
  const saved=captureSession({id:'test',name:'test',query:DEFAULT_HUB_QUERY,metadata,pool,state:state(),config:{strategy:'UCB',totalBudget:50,batchSize:2,model:DEFAULT_MODEL_CONFIG},modules:emptyResearchModules(),selectedRecordKey:null});
  const parsed=parseSession(JSON.parse(JSON.stringify(saved))), sizes:number[]=[];
  const byId=new Map(rows.map(r=>[r.id,r]));
  const restored=await restoreCandidatePool(parsed,undefined,async refs=>{sizes.push(refs.length);return refs.map(r=>byId.get(r.id)!);});
  assert.deepEqual(sizes,[500,500,1]);assert.equal(restored.length,1001);assert.equal(restored[1000].trueProperty,10);
  const abort=new AbortController();let calls=0;
  await assert.rejects(restoreCandidatePool(parsed,abort.signal,async refs=>{calls++;abort.abort();return refs.map(r=>byId.get(r.id)!);}),{name:'AbortError'});assert.equal(calls,1);
});

test('Pareto preference ranking agrees with the selected candidate and responds to weights',()=>{
  const base={composition:{Li:2,O:1},features:[0],observed:true,source:'demo' as const,priceQuality:'scenario' as const,stabilitySource:'test'};
  const pool:ParetoCandidate[]=[{...base,id:'high',formula:'A',objectives:[9,.02,100]},{...base,id:'cheap',formula:'B',objectives:[4,.01,1]}];
  const scales={performance:10,hull:1,price:100};
  for(const weights of [[1,0,0],[0,0,1]] as [number,number,number][]) assert.equal(rankPreferredCandidates(pool,weights,scales)[0].id,preferredCandidate(pool,weights,scales)?.id);
  assert.equal(rankPreferredCandidates(pool,[1,0,0],scales)[0].id,'high');assert.equal(rankPreferredCandidates(pool,[0,0,1],scales)[0].id,'cheap');
});

test('production serves compressed immutable hashed assets while HTML remains revalidatable',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'ai4s-static-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'assets'));
  const body='const material = "Li2O";\n'.repeat(1000);writeFileSync(join(dir,'assets','index-abcdefgh.js'),body);writeFileSync(join(dir,'index.html'),'<html>AI4S</html>');
  const app=express();app.use(compression());app.use(productionAssets(dir));const base=await listen(t,http.createServer(app));
  const result=await new Promise<{headers:http.IncomingHttpHeaders,body:Buffer}>((resolve,reject)=>http.get(base+'/assets/index-abcdefgh.js',{headers:{'Accept-Encoding':'gzip'}},res=>{const chunks:Buffer[]=[];res.on('data',x=>chunks.push(x));res.on('end',()=>resolve({headers:res.headers,body:Buffer.concat(chunks)}));}).on('error',reject));
  assert.equal(result.headers['content-encoding'],'gzip');assert.match(String(result.headers['cache-control']),/31536000, immutable/);assert.match(String(result.headers.vary),/Accept-Encoding/);
  assert.equal(gunzipSync(result.body).toString(),body);assert.ok(result.body.length<body.length/4);
  assert.equal((await fetch(base)).headers.get('cache-control'),'no-cache');
});

test('missing advisor configuration gives a user-facing explanation without environment variable names',()=>{
  for(const lang of ['zh','en'] as const){const message=advisorErrorMessage(new AdvisorError('MISSING_API_KEY'),lang);assert.doesNotMatch(message,/\.env|DEEPSEEK_API_KEY|restart/);assert.ok(message.length>20);}
});

test('restoration rejects a forged random efficiency curve against canonical labels',async()=>{
  const rows=Array.from({length:50},(_,i)=>record(i)), original=await hydrateHubMaterials(rows,metadata);
  const first=await runActiveLearningStep(original,state(),{totalBudget:20,batchSize:2,strategy:'UCB',random:()=>0,comparisonSeed:42},{train(){},predictBatch(r){return r.map(()=>({mean:0,std:.1}));}});
  const saved=captureSession({id:'comparison',name:'comparison',query:DEFAULT_HUB_QUERY,metadata,pool:first.pool,state:first.state,config:{strategy:'UCB',totalBudget:20,batchSize:2,model:DEFAULT_MODEL_CONFIG},modules:emptyResearchModules(),selectedRecordKey:null});
  const byId=new Map(rows.map(r=>[r.id,r]));const fetcher=async (refs:{id:string}[])=>refs.map(ref=>byId.get(ref.id)!);
  await restoreCandidatePool(parseSession(saved),undefined,fetcher);
  const tampered=structuredClone(saved);tampered.state.comparison!.points[0].bestValue=-99;
  await assert.rejects(restoreCandidatePool(parseSession(tampered),undefined,fetcher),/does not match/);
  const fakeCount=structuredClone(saved);fakeCount.state.comparison!.points.push({sampledCount:50,bestValue:.04,sampledIds:rows.map(r=>r.id)});
  await assert.rejects(restoreCandidatePool(parseSession(fakeCount),undefined,fetcher),/does not match/);
});


test('English spectrum provenance and feedback messages are localized',async()=>{
  const {translateUI}=await import('../src/uiTranslations');
  assert.equal(translateUI('离线 MP','en'),'Offline MP');
  assert.doesNotMatch(translateUI('演示谱不能回填真实候选，也不会改变其主动学习排序。','en'),/[\u3400-\u9fff]/);
});
