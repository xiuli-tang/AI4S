import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { HubStore } from "../server/hubStore";
import { createApiApp } from "../server/api";
import { createNetworkClient } from "../server/network";
import { DEFAULT_HUB_QUERY, OBJECTIVES, type HubRecord, type ObjectiveId, type CalibrationResult } from "../src/dataHub";
import { hydrateHubMaterials } from "../src/engine/MaterialsEngine";
import { hubParetoCandidates, materialCandidates } from "../src/engine/pareto/ParetoData";
import { dominates, hypervolume, scalarize, runParetoStep, preferredCandidate } from "../src/engine/pareto/ParetoEngine";
import { materialRecordKey } from "../src/materialContext";
import { measureGeometry, geometrySupplements, replaceGeometrySupplements } from "../src/research/geometry";
import { restoreValidatedFeedback } from "../src/research/validation";
import { resolveSynthesisReference } from "../src/synthesis/reference";
import { canApplySynthesisFeedback, applySynthesisFeedback } from "../src/synthesis/feedback";
import { fromCrystalStructure } from "../src/umlip/configurations";
import { compositionGroup } from "../src/engine/distillation/features";
import { extractCompositionFeatures } from "../src/engine/CompositionFeatures";
import { searchPhysicalFormulas } from "../src/engine/distillation/search";
import type { UmlipService } from "../server/umlip/service";
import type { SynthesisFeedback } from "../src/synthesis/types";
import { importStructures } from "../src/structures/importStructure";
import { examplePoscar } from "../src/structures/examples";
import { buildDistillationSnapshot, parseSupplements, PHYSICAL_FEATURES } from "../src/engine/distillation/features";
import { DEFAULT_MODEL_CONFIG } from "../src/engine/models/config";
import { calibrationObservations, calibratedSurrogate } from "../src/research/calibration";
import { captureSession, parseSession, restoreCandidatePool } from "../src/research/session";
import { researchEvidence } from "../src/research/evidence";
import { configurationEvidence } from "../src/research/links";
import { emptyResearchModules } from "../src/research/types";
import { buildAdvisorContext } from "../src/services/AdvisorContext";
import { material, state } from "./fixtures";
import { listen } from "./httpFixtures";

// Contract-only synthetic records. These tests never write the real Hub or run MACE.
const provenance = { reference: "Synthetic unified-workflow test fixture", url: "https://fixtures.invalid/unified", datasetVersion: "test-1", retrievedAt: "2026-10-29T00:00:00Z", license: "test-only" };
const metadata = (objective: ObjectiveId = "band-gap") => ({ requestedSource: "mp-snapshot" as const, effectiveSource: "mp-snapshot" as const,
  objective, query: { ...DEFAULT_HUB_QUERY, objective }, total: 2, datasetVersion: "test", fetchedAt: provenance.retrievedAt, excludedMissingTarget: 0 });
const record = (id: string, gap = 2): HubRecord => ({ id, formula: "Li2O", composition: { Li: 2, O: 1 }, values: { "band-gap": gap, "formation-energy": -gap, "energy-above-hull": 0 },
  units: { "band-gap": "eV", "formation-energy": "eV/atom", "energy-above-hull": "eV/atom" }, source: "MP-DFT", fidelity: "low-dft", methodMeta: "test-only", cohort: "test", provenance });
const sample = (objective: ObjectiveId = "band-gap", value = 2) => material(0, { source: "Lab-Experiment", datasetSource: "catalysis-hub", fidelity: "high-exp",
  recordRevision: "a".repeat(64), targetKind: objective, trueProperty: value, provenance, cohort: "test", objectiveValues: { [objective]: value, "formation-energy": -2, "energy-above-hull": 0 },
  objectiveUnits: { [objective]: OBJECTIVES[objective].unit, "formation-energy": "eV/atom", "energy-above-hull": "eV/atom" } });

test("bound external hull supplies both value and declared unit when the source lacks hull", () => {
  const m = sample(); delete m.energyAboveHull; delete m.objectiveValues!["energy-above-hull"]; delete m.objectiveUnits!["energy-above-hull"];
  const imported = [{ materialId: m.id, energyAboveHull: .02, source: "test", method: "fixture", referenceSet: "test", recordKey: materialRecordKey(m) }];
  assert.equal(hubParetoCandidates([m], "band-gap", "energy-above-hull", {}, imported).candidates[0].objectives[1], .02);
});

test("geometry replacement clears unavailable old fields and rejects nonmetal centers", async () => {
  const structure = importStructures(examplePoscar, "fixture.POSCAR")[0];
  const six = await measureGeometry(structure, "test-record", 1, 2.5, structure);
  const twelve = await measureGeometry(structure, "test-record", 0, 3);
  const first = geometrySupplements("m", six);
  first.m.bond_dissociation_energy = { value: 4, unit: "eV", source: "external fixture", reference: "test" };
  const next = replaceGeometrySupplements(first, "m", twelve);
  assert.equal(next.m.octahedral_distortion, undefined); assert.equal(next.m.volume_change_per_atom, undefined);
  assert.equal(next.m.bond_dissociation_energy.value, 4); assert.equal(next.m.mean_mo_bond_length.binding?.centerSiteIndex, 0);
  await assert.rejects(measureGeometry(structure, "test-record", 2, 2.5), /金属中心/);
  const partial = structuredClone(structure); partial.sites.forEach(s => s.species[0].occupancy = .5);
  await assert.rejects(measureGeometry(structure, "test-record", 1, 2.5, partial), /满占位/);
});

test("calibrated formula keeps every correction composition out of tuning and test groups", async () => {
  const rows = Array.from({ length: 30 }, (_, i) => {
    const composition = { Li: i + 1, O: 2 }, extracted = extractCompositionFeatures(composition);
    const y = 1 + .4 * extracted.descriptors.statistics.electronegativityPauling.mean! ** 2;
    return material(i, { ...sample(), id: `pair-${i}`, composition, ...extracted, trueProperty: y, pairedDft: y - .5, isSampled: true });
  });
  const calibration = { correction: .5, cohort: "test", objective: "band-gap", unit: "eV", calibrationIds: rows.slice(0, 10).map(m => m.id) };
  const snapshot = buildDistillationSnapshot(rows, { runId: 1, iteration: 1, target: "teacher", objective: "band-gap", modelConfig: DEFAULT_MODEL_CONFIG, calibration });
  const result = await searchPhysicalFormulas(snapshot, { maxCandidates: 100, maxDepth: 2, maxNodes: 5 });
  const used = rows.slice(0, 10).map(m => compositionGroup(m.composition));
  for (const group of used) { assert.ok(result.split.discovery.includes(group)); assert.ok(!result.split.tuning.includes(group)); assert.ok(!result.split.test.includes(group)); }
  assert.equal(result.sourceSnapshot.calibration?.correction, .5); assert.ok(result.teacherMetrics.groups! >= 2);
});

test("converged derived references are proven against exact parents and reconnect XRD priors idempotently", async t => {
  const hub = new HubStore(":memory:"); t.after(() => hub.close());
  const crystal = importStructures(examplePoscar, "fixture.POSCAR")[0];
  const row = { ...record("mp-derived"), formula: "SrTiO3", composition: { Sr: 1, Ti: 1, O: 3 },
    structure: { lattice: { matrix: crystal.lattice }, sites: crystal.sites.map(s => ({ abc: s.fractional, label: s.label, species: s.species.map(sp => ({ element: sp.element, occu: sp.occupancy })) })) } };
  hub.import("mp-snapshot", [row], true); const selected = hub.select("mp-snapshot", DEFAULT_HUB_QUERY);
  const [m] = await hydrateHubMaterials(selected.data.map((r, i) => ({ ...r, revision: selected.revisions[i] })), metadata());
  const c = { id: "cfg-derived", name: "fixture", status: "converged", origin: { recordKey: materialRecordKey(m), structureHash: m.structureHash }, result: { structure: fromCrystalStructure(crystal) } };
  const run = { id: "test-run", candidates: [c], model: { sha256: "f".repeat(64) } };
  const network = createNetworkClient(); t.after(() => network.close());
  const url = await listen(t, http.createServer(createApiApp({ hub, network, env: {}, umlip: { get: () => run } as unknown as UmlipService })));
  const path = url + "/api/umlip/runs/test-run/candidates/cfg-derived/reference";
  const response = await fetch(path); assert.equal(response.status, 200); const proof = await response.json();
  assert.equal(proof.binding.derived.parentStructureHash, m.structureHash);
  const modules = emptyResearchModules();
  modules.structures = [{ id: "artifact", stage: "relaxed", runId: run.id, candidateId: c.id, structure: proof.structure,
    structureHash: proof.binding.structureHash, recordKey: materialRecordKey(m), createdAt: provenance.retrievedAt }];
  modules.experiments = [{ id: "test-report", reference: { binding: proof.binding } } as any];
  assert.equal(configurationEvidence(modules, run.id, c.id).xrd?.id, "test-report");
  assert.equal(configurationEvidence(modules, run.id, "different-converged-configuration").xrd, undefined);
  const linked = { ...m, validationStructure: proof.binding, acquisitionValue: 10 };
  const resolved = await resolveSynthesisReference({ requestId: 1, composition: m.composition, materialId: m.id, recordKey: materialRecordKey(m), structure: proof.structure, referenceBinding: proof.binding }, linked);
  assert.equal(resolved.binding.kind, "derived");
  const feedback: SynthesisFeedback = { schemaVersion: 2, materialId: m.id, formula: m.formula, recordKey: materialRecordKey(m), reference: resolved.binding,
    status: "pass", score: 90, mainFraction: 95, prior: .4, demo: false, sampleId: "contract-fixture", filename: "contract.xy", createdAt: provenance.retrievedAt };
  assert.equal(canApplySynthesisFeedback(linked, feedback), true); assert.equal(canApplySynthesisFeedback(linked, { ...feedback, demo: true }), false);
  const applied = applySynthesisFeedback([linked], feedback);
  const restored = await restoreValidatedFeedback(applied, {}, undefined, async () => proof.binding);
  assert.equal(restored.pool[0].acquisitionValue, 4); assert.equal(restored.unavailable, 0);
  const reloaded = await restoreValidatedFeedback([{ ...m, acquisitionValue: 10 }], { [materialRecordKey(m)]: feedback }, undefined, async () => proof.binding);
  assert.equal(reloaded.pool[0].acquisitionValue, 4);
  const missing = await restoreValidatedFeedback(applied, {}, undefined, async () => { throw new Error("missing run"); });
  assert.equal(missing.pool[0].synthesisFeedback, undefined); assert.equal(missing.pool[0].acquisitionValue, 10);
  c.origin.structureHash = "0".repeat(64); assert.equal((await fetch(path)).status, 400);
  c.origin.structureHash = m.structureHash; c.status = "unconverged"; assert.equal((await fetch(path)).status, 400);
});

test("all seven Hub targets enter explicit multiobjective mode with original units and directions", () => {
  for (const id of Object.keys(OBJECTIVES) as ObjectiveId[]) {
    const result = hubParetoCandidates([sample(id)], id, null);
    assert.equal(result.candidates.length, 1, id);
    assert.deepEqual(result.problem.active, [0, 2]);
    assert.equal(result.problem.axes[0].direction, OBJECTIVES[id].direction);
    assert.equal(result.problem.axes[0].unit, OBJECTIVES[id].unit);
    assert.equal(result.candidates[0].lineage?.recordKey, materialRecordKey(sample(id)));
  }
  assert.equal(materialCandidates([sample("formation-energy", -2)]).candidates.length, 0, "legacy three-target API stays compatible");
});

test("generic min/min dominance permits negative energies and two-target HV matches an independent rectangle", () => {
  const d = hubParetoCandidates([sample("formation-energy", -4)], "formation-energy", null);
  const c = { ...d.candidates[0], observed: true, objectives: [-4, 0, 0] as [number, number, number] };
  assert.equal(hypervolume([c], d.scales, d.problem), .5);
  assert.equal(dominates([-4, 0, 2], [-2, -1000, 3], d.problem), true, "inactive second slot cannot affect dominance");
  assert.ok(Number.isFinite(scalarize(c.objectives, [0, 100, 0], d.scales, d.problem)));
  const three = hubParetoCandidates([sample("band-gap", 2)], "band-gap", "formation-energy");
  assert.equal(dominates([3, -3, 1], [2, -2, 2], three.problem), true);
});

test("secondary properties are read from the same record, preserve zero and reject a mismatched unit", () => {
  const m = sample();
  assert.equal(hubParetoCandidates([m], "band-gap", "energy-above-hull").candidates[0].objectives[1], 0);
  const bad = { ...m, objectiveUnits: { ...m.objectiveUnits, "energy-above-hull": "meV/atom" } };
  assert.equal(hubParetoCandidates([bad], "band-gap", "energy-above-hull").candidates.length, 0);
  assert.equal(hubParetoCandidates([m], "band-gap", "overpotential").missingStability, 1);
});

test("XRD constraints alter subsequent ParEGO and current preference without changing observed physical objectives", async () => {
  const rows = Array.from({ length: 8 }, (_, i) => ({ ...sample(), id: `row-${i}`, recordRevision: String(i).repeat(64), structureHash: "c".repeat(64),
    structureRef: { dataset: "catalysis-hub" as const, id: `row-${i}`, revision: String(i).repeat(64) } }));
  rows[6].synthesisFeedback = { schemaVersion: 2, materialId: rows[6].id, formula: rows[6].formula, recordKey: materialRecordKey(rows[6]),
    reference: { kind: "record", structureHash: rows[6].structureHash, recordKey: materialRecordKey(rows[6]), structureRef: rows[6].structureRef },
    status: "impurity", score: 20, mainFraction: 50, prior: .1, demo: false, sampleId: "test-sample", filename: "test.xy", createdAt: provenance.retrievedAt };
  const d = hubParetoCandidates(rows, "band-gap", "energy-above-hull");
  assert.equal(d.candidates[6].synthesisStatus, "impurity");
  const pool = d.candidates.map((c, i) => ({ ...c, observed: i < 6 })), before = JSON.stringify(pool);
  const next = await runParetoStep(pool, { round: 1, history: [] }, { budget: 8, seed: 42, weights: [50, 25, 25], scales: d.scales, problem: d.problem },
    { train: () => {}, predictBatch: points => points.map(() => ({ mean: 1, std: 1 })) });
  assert.equal(next.pool[6].observed, false); assert.equal(next.pool[7].observed, true); assert.equal(JSON.stringify(pool), before);
  const known = d.candidates.map(c => ({ ...c, observed: true }));
  assert.notEqual(preferredCandidate(known, [50, 25, 25], d.scales, d.problem)?.id, rows[6].id);
  rows[6].synthesisFeedback!.reference!.structureHash = "d".repeat(64);
  assert.equal(hubParetoCandidates(rows, "band-gap", "energy-above-hull").candidates[6].synthesisPrior, 1);
});

test("periodic TiO6 includes both images of each oxygen and returns exact cubic bond statistics", async () => {
  const structure = importStructures(examplePoscar, "fixture.POSCAR")[0];
  const result = await measureGeometry(structure, "test-record", 1, 2.5);
  assert.equal(result.neighbors.length, 6);
  assert.equal(new Set(result.neighbors.map(n => n.siteIndex)).size, 3);
  assert.equal(new Set(result.neighbors.map(n => `${n.siteIndex}/${n.image.join()}`)).size, 6);
  assert.ok(Math.abs(result.meanBondLength! - 1.9525) < 1e-12);
  assert.ok(result.octahedralDistortion! < 1e-24);
  const sr = await measureGeometry(structure, "test-record", 0, 3);
  assert.equal(sr.neighbors.length, 12); assert.equal(sr.octahedralDistortion, null);
});

test("tetragonal bond distortion matches analytic six-bond variance and explicit reference volume", async () => {
  const reference = importStructures(examplePoscar, "reference.POSCAR")[0], tetragonal = structuredClone(reference);
  tetragonal.lattice[2][2] = 4.1;
  const r = await measureGeometry(tetragonal, "test-record", 1, 2.5, reference);
  const bonds = [1.9525, 1.9525, 1.9525, 1.9525, 2.05, 2.05], mean = bonds.reduce((a, b) => a + b) / 6;
  const variance = bonds.reduce((s, b) => s + (b - mean) ** 2, 0) / 6;
  assert.ok(Math.abs(r.octahedralDistortion! - variance / mean ** 2) < 1e-14);
  assert.ok(Math.abs(r.volumeChangePerAtom! - (3.905 ** 2 * (4.1 - 3.905) / 5)) < 1e-12);
});

test("geometry supplements preserve structure bindings and reject a reused material ID from another revision", async () => {
  const m = sample(), structure = importStructures(examplePoscar, "fixture.POSCAR")[0];
  const r = await measureGeometry(structure, materialRecordKey(m), 1, 2.5);
  const supplements = parseSupplements(JSON.stringify(geometrySupplements(m.id, r)), new Set([m.id]));
  const input = { runId: 1, iteration: 1, target: "observed" as const, objective: "band-gap" as const, modelConfig: DEFAULT_MODEL_CONFIG, supplements };
  const snapshot = buildDistillationSnapshot([{ ...m, isSampled: true }], input);
  assert.ok(snapshot.supplements.some(s => s.binding?.structureHash === r.structureHash));
  const index = PHYSICAL_FEATURES.findIndex(f => f.id === "mean_mo_bond_length");
  assert.ok(Math.abs(snapshot.samples[0].values[index]! - 1.9525) < 1e-12);
  assert.throws(() => buildDistillationSnapshot([{ ...m, recordRevision: "b".repeat(64) }], input), /版本/);
});

test("calibrated prediction trains on observed paired DFT and shifts the predicted mean only", async () => {
  const pool = Array.from({ length: 12 }, (_, i) => ({ ...sample(), id: `pair-${i}`, pairedDft: i, trueProperty: i + 2 }));
  const calibration: CalibrationResult = { objective: "band-gap", unit: "eV", cohort: "test", model: "constant-bias", correction: 2,
    calibrationIds: pool.slice(0, 10).map(m => m.id), validationIds: pool.slice(10).map(m => m.id), calibrationGroups: 10, validationGroups: 2, validation: null, note: "test" };
  const observed = calibrationObservations(calibration, pool); assert.equal(observed.filter(m => m.isSampled).length, 10); assert.ok(pool.every(m => !m.isSampled));
  let labels: number[] = [];
  const model = calibratedSurrogate({ train: async data => { labels = data.map(m => m.trueProperty); }, predictBatch: () => [{ mean: 3, std: .2 }] }, calibration);
  await model.train(observed.filter(m => m.isSampled));
  assert.deepEqual(labels, Array.from({ length: 10 }, (_, i) => i));
  assert.deepEqual(await model.predictBatch([{ features: [0] }]), [{ mean: 5, std: .2 }]);
  assert.throws(() => calibrationObservations({ ...calibration, unit: "mV" }, pool), /单位/);
});

test("research export excludes unused oracle fields, restores exact historical rows and preserves module settings", async t => {
  const hub = new HubStore(":memory:"); t.after(() => hub.close()); hub.import("mp-snapshot", [record("mp-u1", 2), record("mp-u2", 9)], true);
  const selection = hub.select("mp-snapshot", DEFAULT_HUB_QUERY);
  const rows = selection.data.map((r, i) => ({ ...r, revision: selection.revisions[i] }));
  const pool = await hydrateHubMaterials(rows, metadata()); pool[0].isSampled = true; pool[0].predictedMean = 1.8;
  const modules = emptyResearchModules(); modules.advisor = { turns: [], draft: "keep my question", selectedId: pool[0].id, preview: true, compact: false };
  const session = captureSession({ id: "test-project", name: "roundtrip", query: DEFAULT_HUB_QUERY, metadata: metadata(), pool,
    state: state({ iteration: 1, sampledCount: 1, bestValue: 2, history: [{ iteration: 1, bestValue: 2, regret: 7, avgError: 0 }] }),
    config: { strategy: "UCB", batchSize: 2, totalBudget: 50, model: DEFAULT_MODEL_CONFIG }, modules, selectedRecordKey: materialRecordKey(pool[0]) });
  assert.equal(session.candidates[1].observedValue, undefined);
  for (const field of ["trueProperty", "objectiveValues", "energyAboveHull", "formationEnergyPerAtom", "pairedDft"]) assert.equal(field in session.candidates[1], false);
  assert.equal("regret" in session.state.history[0], false);
  const badTime = structuredClone(session); delete (badTime as any).savedAt; assert.throws(() => parseSession(badTime), /格式/);
  const badModules = structuredClone(session); delete (badModules.modules as any).structures; assert.throws(() => parseSession(badModules), /模块/);
  const tamperedFeatures = structuredClone(session); tamperedFeatures.candidates[0].features.fill(98765);
  const canonical = await restoreCandidatePool(tamperedFeatures, undefined, async refs => refs.map(ref => ({ ...hub.record(ref.dataset, ref.id, ref.revision)!.row, revision: ref.revision })));
  assert.notDeepEqual(canonical[0].features, tamperedFeatures.candidates[0].features);
  hub.import("mp-snapshot", [record("mp-u1", 100)], true);
  const restored = await restoreCandidatePool(parseSession(JSON.parse(JSON.stringify(session))), undefined, async refs => refs.map(ref => {
    const old = hub.record(ref.dataset, ref.id, ref.revision)!; return { ...old.row, revision: old.revision };
  }));
  assert.equal(restored[0].trueProperty, 2); assert.equal(restored[1].trueProperty, 9);
  assert.equal(restored[0].isSampled, true); assert.equal(restored[1].isSampled, false);
  assert.equal(restored[0].predictedMean, 1.8); assert.equal(session.modules.advisor!.draft, "keep my question");
  await assert.rejects(() => restoreCandidatePool(session, undefined, async () => []), /血统/);
});

test("exact-record API restores a version without requiring a structure or issuing an upstream request", async t => {
  const hub = new HubStore(":memory:"); t.after(() => hub.close()); hub.import("mp-snapshot", [record("mp-u1", 2)], true);
  const revision = hub.select("mp-snapshot", DEFAULT_HUB_QUERY).revisions[0]; hub.import("mp-snapshot", [record("mp-u1", 99)], true);
  const network = createNetworkClient({ proxyResolver: () => "" }); t.after(() => network.close());
  const base = await listen(t, http.createServer(createApiApp({ network, hub, env: {} })));
  const response = await fetch(base + "/api/hub/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refs: [{ dataset: "mp-snapshot", id: "mp-u1", revision }] }) });
  assert.equal(response.status, 200); assert.equal((await response.json()).data[0].values["band-gap"], 2);
  const denied = await fetch(base + "/api/hub/records", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://other.invalid" }, body: "{}" }); assert.equal(denied.status, 403);
});

test("cross-module advisor evidence contains observed results and no unused Pareto labels", () => {
  const modules = emptyResearchModules(); const data = hubParetoCandidates([sample()], "band-gap", null);
  modules.pareto = { mode: "materials-project", weights: [50, 25, 25], budget: 20, seed: 42, strategy: "ParEGO", prices: {}, externalStability: [], secondary: "none", problem: data.problem,
    pool: [{ ...data.candidates[0], observed: true }, { ...data.candidates[0], id: "hidden", objectives: [99999, 0, 1], observed: false }], state: { round: 1, history: [] }, replay: null };
  const evidence = researchEvidence(modules); assert.equal(evidence.pareto!.frontier.length, 1); assert.equal(JSON.stringify(evidence).includes("99999"), false);
  const context = buildAdvisorContext({ pool: [sample()], state: state(), strategy: "UCB", batchSize: 2, totalBudget: 50, isRealData: true, runId: 1, modelConfig: DEFAULT_MODEL_CONFIG, moduleEvidence: evidence });
  assert.equal(context.module_evidence?.pareto?.observed, 1); assert.equal(context.selected_material, null);
});
