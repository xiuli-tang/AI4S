import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePresentationPreset } from "../src/demo/presentation";
import { candidateReportSections, presetReport, reportCandidates, safeReportMaterial, sessionReport } from "../src/research/report";
import { reportHtml, structureSvg } from "../src/research/reportHtml";
import { sharedDecisionArchive, synchronizeDecisionObservations } from "../src/research/decision";
import { DEFAULT_SCENE_QUERY, RESEARCH_SCENES, sceneForQuery } from "../src/research/scenes";
import { captureSession, parseSession } from "../src/research/session";
import { emptyResearchModules } from "../src/research/types";
import { DEFAULT_MODEL_CONFIG } from "../src/engine/models/config";
import { runActiveLearningStep } from "../src/engine/ActiveLearningLoop";
import { materialRecordKey } from "../src/materialContext";
import { researchEvidence } from "../src/research/evidence";
import { learningBenchmark, quantile } from "../src/research/benchmark";
import { material, state } from "./fixtures";
const preset = () => validatePresentationPreset(JSON.parse(readFileSync(new URL("../src/demo/presentation-preset.json", import.meta.url), "utf8")));
function saved() {
  const p = preset();
  return captureSession({ id: "test-report", name: "Research report", query: DEFAULT_SCENE_QUERY, metadata: null,
    pool: p.learning.pool, state: p.learning.state, config: { strategy: "UCB", batchSize: 1, totalBudget: 24, model: DEFAULT_MODEL_CONFIG },
    modules: emptyResearchModules(), selectedRecordKey: null });
}
test("the entry scenario selects Li/O plus stability, while future scenarios stay explicitly unavailable", () => {
  assert.equal(DEFAULT_SCENE_QUERY.source, "mp-snapshot"); assert.equal(DEFAULT_SCENE_QUERY.elements, "Li,O");
  assert.equal(sceneForQuery(DEFAULT_SCENE_QUERY), "solid-electrolyte");
  assert.equal(sceneForQuery({ ...DEFAULT_SCENE_QUERY, objective: "overpotential" }), "custom");
  assert.deepEqual(RESEARCH_SCENES.map(s => s.available), [true, false, false]);
});
test("reports rank evaluated outcomes in the correct direction and never substitute a high-UCB unobserved candidate", () => {
  const candidates = [material(0, { isSampled: true, trueProperty: 2 }), material(1, { isSampled: true, trueProperty: 5 }),
    material(2, { isSampled: false, trueProperty: 999, acquisitionValue: 999 })].map(safeReportMaterial);
  assert.equal(reportCandidates(candidates, "band-gap")[0].observedValue, 5);
  assert.equal(reportCandidates(candidates, "energy-above-hull")[0].observedValue, 2);
  assert.equal(candidates[2].observedValue, undefined); assert.equal(candidates[2].observedProperties, undefined);
  assert.ok(candidates.every(c => !("trueProperty" in c) && !("objectiveValues" in c)));
});
test("the shared decision uses the exact acquired records and does not count an extra evaluation", () => {
  const p = preset(), archive = sharedDecisionArchive(p.learning.pool, "band-gap", 42);
  const known = new Set(p.learning.pool.filter(m => m.isSampled).map(materialRecordKey));
  assert.equal(archive.workflowShared, true); assert.equal(archive.problem?.axes[1].id, "energy-above-hull");
  assert.ok(archive.pool.filter(c => c.observed).every(c => known.has(c.lineage!.recordKey)));
  assert.equal(archive.state.history[0].observed, archive.pool.filter(c => c.observed).length);
});
test("the final prediction pass trains on the final acquired batch", async () => {
  const sizes: number[] = [];
  const model = { train(rows: unknown[]) { sizes.push(rows.length); }, predictBatch(rows: unknown[]) { return rows.map(() => ({ mean: sizes.at(-1)!, std: .1 })); } };
  const pool = Array.from({ length: 20 }, (_, i) => material(i));
  const a = await runActiveLearningStep(pool, state(), { totalBudget: 7, batchSize: 2, strategy: "UCB", random: () => 0 }, model);
  const b = await runActiveLearningStep(a.pool, a.state, { totalBudget: 7, batchSize: 2, strategy: "UCB" }, model);
  assert.equal(b.stopReason, "budget-exhausted"); assert.equal(sizes.at(-1), 7);
  assert.ok(b.pool.filter(m => !m.isSampled).every(m => m.predictedMean === 7));
  assert.equal(b.state.comparison!.points.at(-1)!.sampledCount, 7);
});
test("archived reports preserve acquired auxiliary properties and reject unused labels", () => {
  const s = saved(), p = preset();
  for (const c of s.candidates) assert.deepEqual(c.observedProperties, c.isSampled ? p.learning.pool.find(m => m.id === c.id)!.objectiveValues : undefined);
  parseSession(JSON.parse(JSON.stringify(s)));
  const unobserved = s.candidates.find(c => !c.isSampled)!; unobserved.observedProperties = { "band-gap": 123 };
  assert.throws(() => parseSession(s), /辅助性质/);
});
test("the preset uses the common five-question report and keeps independent MACE/XRD cases separate", () => {
  const report = presetReport(preset()), first = reportCandidates(report.candidates, "band-gap")[0];
  assert.equal(candidateReportSections(first, report, "zh").length, 5);
  assert.equal(report.cases.length, 2); assert.ok(report.cases.every(c => c.example && !c.recordKey));
  assert.ok(report.cases[0].xrd?.demo); assert.equal(report.cases[1].xrd, undefined);
  assert.equal(report.modules.umlip, null); // Missing original run metadata is not invented.
});
test("candidate reports only include calculations and spectra bound to that exact record", () => {
  const s = saved(), m = s.candidates[0], p = preset();
  s.modules.umlip = { candidates: [], run: { id: "test-run", candidates: p.umlip.candidates.map((c, i) => ({ ...c,
    origin: { recordKey: i ? "another-revision" : m.recordKey, structureHash: "a".repeat(64) } })) } } as any;
  const report = sessionReport(s), evidence = researchEvidence(s.modules, m.recordKey);
  assert.equal(evidence.umlip?.converged.length, 1);
  assert.equal(report.cases.filter(c => c.recordKey === m.recordKey).length, 1);
  assert.equal(report.cases[0].xrd, undefined);
});
test("HTML export embeds the actual report, crystal and spectrum graphics and escapes untrusted content", () => {
  const report = presetReport(preset()); report.name = '<script>alert("x")</script>';
  const c = reportCandidates(report.candidates, "band-gap")[0]; c.formula = '<img src=x onerror=alert(1)>';
  c.provenance = { ...c.provenance!, url: "javascript:alert(1)" };
  const html = reportHtml(report);
  assert.doesNotMatch(html, /<script|<img|href="javascript:/);
  assert.match(html, /&lt;script&gt;/); assert.match(html, /Crystal structure projection/); assert.match(html, /XRD comparison/);
  assert.match(html, /打印 \/ 另存为 PDF/); assert.match(html, /合成演示谱/);
  assert.doesNotMatch(html, /src="https?:/);
  assert.doesNotMatch(html, /<details>/); assert.match(html, /<details open>/);
});
test("shared decisions follow new main observations and clear them on a main reset", () => {
  const p = preset(), initial = sharedDecisionArchive(p.learning.pool, "band-gap", 42);
  const pending = p.learning.pool.find(m => !m.isSampled && initial.pool.some(c => c.lineage?.recordKey === materialRecordKey(m)))!;
  const changed = p.learning.pool.map(m => m.id === pending.id ? { ...m, isSampled: true, iteration: 21 } : m);
  const next = synchronizeDecisionObservations(initial.pool, changed, initial.weights, { performance: 12, hull: .5, price: 6000 }, initial.problem);
  assert.equal(next.pool.filter(c => c.observed).length, initial.pool.filter(c => c.observed).length + 1);
  const reset = synchronizeDecisionObservations(next.pool, changed.map(m => ({ ...m, isSampled: false })), initial.weights, { performance: 12, hull: .5, price: 6000 }, initial.problem);
  assert.equal(reset.pool.filter(c => c.observed).length, 0); assert.equal(reset.state.history.length, 0);
});
test("retained relaxed artifacts survive changing the active run and retain only their exact spectrum", () => {
  const s = saved(), p = preset(), key = s.candidates[0].recordKey;
  s.modules.structures = [{ id: "retained", stage: "relaxed", recordKey: key, structure: p.umlip.candidates[0].crystal,
    structureHash: "a".repeat(64), runId: "old-run", candidateId: "old-cfg", createdAt: s.savedAt }];
  s.modules.experiments = [{ id: "exact-xrd", reference: { binding: { kind: "derived", recordKey: key, structureHash: "a".repeat(64),
    derived: { runId: "old-run", candidateId: "old-cfg" } } } } as any];
  const report = sessionReport(s); assert.equal(report.cases.length, 1); assert.equal(report.cases[0].xrd?.id, "exact-xrd");
  assert.equal(report.cases[0].configuration, undefined);
  s.modules.experiments[0].reference.binding!.derived!.candidateId = "other";
  assert.equal(sessionReport(s).cases[0].xrd, undefined);
});
test("exported crystal geometry responds to the actual lattice, including noncubic cells", () => {
  const crystal = preset().umlip.candidates[0].crystal, stretched = structuredClone(crystal);
  stretched.lattice[2] = stretched.lattice[2].map(v => v * 2) as [number, number, number];
  assert.notEqual(structureSvg(crystal), structureSvg(stretched));
});
test("a known-material rediscovery benchmark excludes target compositions from the shared initial labels and is reproducible", async () => {
  const p = preset(), target = p.learning.pool[0].id;
  const options = { seeds: [101, 102], budget: 10, objective: "band-gap" as const, rediscoverIds: [target] };
  const a = await learningBenchmark(p.learning.pool, options), b = await learningBenchmark(p.learning.pool, options);
  assert.deepEqual(a, b); assert.ok(a.rows.every(r => !r.initialIds.includes(target)));
  assert.equal(a.rows[0].traces[0].ai, a.rows[0].traces[0].random);
  assert.equal(a.rows[0].traces.at(-1)!.evaluations, 10);
  assert.equal(quantile([4, 1, 2, 3], .5), 2.5); assert.equal(quantile([], .5), null);
  await assert.rejects(learningBenchmark(p.learning.pool, { ...options, targetValue: NaN }), /finite/);
});
