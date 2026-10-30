import Database from "better-sqlite3";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { extractCompositionFeatures } from "../src/engine/CompositionFeatures";
import { runActiveLearningStep } from "../src/engine/ActiveLearningLoop";
import { SurrogateModel } from "../src/engine/SurrogateModel";
import { seededRandom } from "../src/engine/models/math";
import { DEFAULT_MODEL_CONFIG } from "../src/engine/models/config";
import { buildDistillationSnapshot } from "../src/engine/distillation/features";
import { searchPhysicalFormulas } from "../src/engine/distillation/search";
import { materialCandidates, PARETO_SCALES } from "../src/engine/pareto/ParetoData";
import { INITIAL_PARETO_STATE, paretoFront, runParetoStep } from "../src/engine/pareto/ParetoEngine";
import { normalizeMaterialStructure } from "../src/structures/materialStructure";
import { structureFingerprint } from "../src/structures/fingerprint";
import { asCrystalStructure } from "../src/umlip/configurations";
import type { Material, ALState } from "../src/types";
import type { HubRecord } from "../src/dataHub";
import type { UmlipRun } from "../src/umlip/types";
import type { PresentationPreset } from "../src/demo/types";

const arg = (name: string) => { const i = process.argv.indexOf(name); if (i < 0 || !process.argv[i + 1]) throw new Error(`Required: ${name}`); return resolve(process.argv[i + 1]); };
const database = arg("--db"), runPath = arg("--mace-run"), python = arg("--python");
const output = process.argv.includes("--out") ? arg("--out") : resolve("src/demo/presentation-preset.json");
const db = new Database(database, { readonly: true, fileMustExist: true });
const records = db.prepare("SELECT payload,revision FROM mp_snapshot ORDER BY id LIMIT 40").all() as { payload: string; revision: string }[];
db.close();
const pool: Material[] = [];
let mpRetrievedAt = "";
for (const item of records) {
  const row = JSON.parse(item.payload) as HubRecord;
  const retrieved = row.provenance.retrievedAt;
  if (retrieved > mpRetrievedAt) mpRetrievedAt = retrieved;
  if (!Number.isFinite(row.values["band-gap"])) continue;
  const material: Material = { id: row.id, formula: row.formula, composition: row.composition,
    ...extractCompositionFeatures(row.composition), source: row.source, fidelity: row.fidelity,
    methodMeta: row.methodMeta, cohort: row.cohort, provenance: row.provenance, datasetSource: "mp-snapshot",
    recordRevision: item.revision, targetKind: "band-gap", trueProperty: row.values["band-gap"]!,
    objectiveValues: row.values, objectiveUnits: row.units, energyAboveHull: row.values["energy-above-hull"] ?? null,
    formationEnergyPerAtom: row.values["formation-energy"] ?? null,
    cost: 1 + .2 * Object.values(row.composition).reduce((a, b) => a + b, 0), isSampled: false };
  if (row.structure) {
    material.structureRef = { dataset: "mp-snapshot", id: row.id, revision: item.revision };
    material.structureHash = await structureFingerprint(normalizeMaterialStructure({ material_id: row.id, formula_pretty: row.formula,
      structure: row.structure, symmetry: row.symmetry }, row.id, retrieved, true));
  }
  pool.push(material);
}
let observed = structuredClone(pool);
let state: ALState = { iteration: 0, sampledCount: 0, budget: 24, bestValue: -Infinity, history: [] };
const model = new SurrogateModel(DEFAULT_MODEL_CONFIG);
for (let round = 0; round < 20; round++) {
  const result = await runActiveLearningStep(observed, state, { totalBudget: 24, batchSize: 1, strategy: "UCB", direction: "max", random: seededRandom(2026) }, model);
  if (!result.advanced) throw new Error("Insufficient records for 20 learning rounds");
  observed = result.pool; state = result.state;
}
const formula = await searchPhysicalFormulas(buildDistillationSnapshot(observed, { runId: 1, iteration: state.iteration,
  target: "observed", objective: "band-gap", modelConfig: DEFAULT_MODEL_CONFIG, supplements: {} }));
if (!formula.formulas.length) throw new Error("No formula generated");
let paretoPool = materialCandidates(pool).candidates, paretoState = INITIAL_PARETO_STATE();
if (paretoPool.length < 20) throw new Error("Need 20 MP candidates with stability and reference prices");
const paretoModel = new SurrogateModel(DEFAULT_MODEL_CONFIG);
while (paretoPool.filter(c => c.observed).length < 20) {
  const result = await runParetoStep(paretoPool, paretoState, { budget: 20, weights: [50, 25, 25], scales: PARETO_SCALES["materials-project"], seed: 42 }, paretoModel);
  paretoPool = result.pool; paretoState = result.state;
}
const sourceRun = JSON.parse(readFileSync(runPath, "utf8")) as UmlipRun;
if (!sourceRun.model || !sourceRun.reference) throw new Error("MACE archive lacks provenance");
const candidates = sourceRun.candidates.filter(c => ["demo-0", "demo-4"].includes(c.id)).map(c => {
  if (c.status !== "converged" || !c.result) throw new Error("Archived structure is not converged");
  const root = join(dirname(runPath), c.id);
  return { ...c, trajectory: readFileSync(join(root, "trajectory.jsonl"), "utf8"), poscar: readFileSync(join(root, "POSCAR.relaxed"), "utf8"),
    crystal: asCrystalStructure(c.result.structure, c.name, `${c.id}-MACE-relaxed.POSCAR`) };
});
if (candidates.length !== 2) throw new Error("Need two archived MACE structures");
const structure = candidates[0].crystal;
const pythonCode = `import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('engine',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nstructure=json.loads(sys.stdin.read());x=m.xrd({'structure':structure});d=m.demo({**x,'kind':'clean'});c=m.compare({**x,'points':d['points']});print(json.dumps({'result':x,'points':d['points'],'comparison':c},ensure_ascii=False,allow_nan=False))`;
const xrd = JSON.parse(execFileSync(python, ["-c", pythonCode, resolve("scripts/synthesis_engine.py")], { input: JSON.stringify(structure), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
const now = new Date().toISOString();
const firstHV = paretoState.history[0].hypervolume, lastHV = paretoState.history.at(-1)!.hypervolume;
const gain = firstHV ? (lastHV / firstHV - 1) * 100 : 0;
const front = paretoFront(paretoPool);
const best = observed.filter(m => m.isSampled).sort((a, b) => b.trueProperty - a.trueProperty)[0];
const answer = `## 本轮结论\n\n20 轮主动学习已完成，累计采样 **${state.sampledCount}** 个材料记录。当前最高数据库带隙来自 **${best.formula}（${best.id}）**，为 **${best.trueProperty.toFixed(3)} eV**；建议将它与成本优先方案并列纳入下一轮验证。\n\n## 机理线索：从组成到可阅读的公式\n\n白盒引擎从电负性、半径、价电子和原子硬度的组成统计量中，筛选出 ${formula.formulas.length} 项解析描述符。方程为：\n\n\`ŷ = ${formula.intercept.toPrecision(5)} ${formula.formulas.map(f => `${f.coefficient >= 0 ? "+" : "−"} ${Math.abs(f.coefficient).toPrecision(5)} × ${f.text}`).join(" ")}\`\n\n这些项把组成的电子与尺寸差异转成可讨论的选材线索。项目团队可据此比较化学组成变化和带隙趋势，再选择结构与电子态计算验证机制。\n\n## 商业取舍：性能与采购成本协同决策\n\nMP 三目标寻优已评价 **20** 个候选，形成 **${front.length}** 个非支配方案，前沿超体积增长 **${gain.toFixed(1)}%**。性能旗舰用于寻找功能上限，成本优先用于筛选采购成本更低的替代路线；优先保留能同时改善带隙、Ehull 或采购价的候选。\n\n## 结构与表征：把候选推进到验证\n\n两份 SrTiO₃ 构型档案均已达到 MACE 力收敛阈值，其中扰动构型完成 **${candidates[1].result!.steps}** 个离子步。XRD 自动校正 **${xrd.comparison.shift.toFixed(3)}°** 偏移，谱图一致性 **${xrd.comparison.score.toFixed(1)}/100**，主相拟合占比 **${xrd.comparison.mainFraction.toFixed(1)}%**。\n\n## 建议的下一步\n\n1. 从性能旗舰、均衡优选和成本优先各选一例，统一记录来源、组成和结构版本。\n2. 对入围体系做同设置的 DFT 带隙/稳定性复核，并把结构优化与电子性质分开验收。\n3. 以同一参考晶胞进行 XRD 对照，结合具体制备工艺和样品信息形成实验计划。`;
const preset: PresentationPreset = { schema: "ai4s-presentation-1", id: "integrated-roadshow-20261028", createdAt: now,
  provenance: { baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), mpRetrievedAt, recordCount: pool.length, seed: 42, initialSamplingSeed: 2026,
    description: "MP snapshot; 20 executed UCB rounds; computed symbolic search and ParEGO; two original converged MACE records; pymatgen demo-spectrum fit; snapshot-based Codex advisor brief" },
  learning: { pool: observed, state, strategy: "UCB", batchSize: 1, budget: 24, formula },
  pareto: { pool: paretoPool, state: paretoState, scales: PARETO_SCALES["materials-project"], budget: 20, weights: [50, 25, 25], seed: 42 },
  umlip: { sourceRunId: sourceRun.id, sourceRounds: sourceRun.rounds.length, sourceConverged: sourceRun.candidates.filter(c => c.status === "converged").length,
    model: sourceRun.model, reference: sourceRun.reference, fmax: sourceRun.settings.fmax, candidates },
  xrd: { ...xrd, structure, demo: true, filename: "roadshow-single-phase.xy" },
  advisor: { title: "从高带隙候选到可执行的验证路线", answer, source: "Codex · 基于路演快照生成的预置解读", generatedAt: now } };
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(preset));
console.log(JSON.stringify({ output, bytes: readFileSync(output).length, sha256: createHash("sha256").update(readFileSync(output)).digest("hex"),
  rounds: state.iteration, sampled: state.sampledCount, formula: formula.formulas.map(f => f.text), formulaTest: formula.metrics,
  paretoObserved: 20, paretoFront: front.length, hvGrowth: gain, convergedStructures: candidates.length, xrdScore: xrd.comparison.score }));
