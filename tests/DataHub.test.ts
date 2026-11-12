import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import axios from "axios";
import { HubStore, parseHubQuery, validateHubRecord, validatePair } from "../server/hubStore";
import { createApiApp } from "../server/api";
import { createNetworkClient } from "../server/network";
import { OBJECTIVES, DEFAULT_HUB_QUERY, type FidelityPair, type HubRecord, type HubResponse } from "../src/dataHub";
import { calibratePairs } from "../src/engine/DualFidelityCalibration";
import { AcquisitionFunction } from "../src/engine/AcquisitionFunction";
import { runActiveLearningStep } from "../src/engine/ActiveLearningLoop";
import { MaterialsEngine } from "../src/engine/MaterialsEngine";
import { MaterialStructureService } from "../src/services/MaterialStructureService";
import { buildAdvisorContext } from "../src/services/AdvisorContext";
import { DEFAULT_MODEL_CONFIG } from "../src/engine/models/config";
import { material, state } from "./fixtures";
import { json, listen } from "./httpFixtures";

// Synthetic contract fixtures exist only in isolated tests, never in the shipped/local hub database.
const provenance = { reference: "Synthetic contract fixture, not materials evidence", url: "https://fixtures.invalid/data-hub", datasetVersion: "test-1", retrievedAt: "2026-10-28T00:00:00Z", license: "test-only" };
const structure = { lattice: { matrix: [[3, 0, 0], [0, 3, 0], [0, 0, 3]], pbc: [true, true, true] }, sites: [
  { species: [{ element: "Li", occu: 1 }], abc: [0, 0, 0] }, { species: [{ element: "Li", occu: 1 }], abc: [0.5, 0, 0.5] }, { species: [{ element: "O", occu: 1 }], abc: [0.5, 0.5, 0.5] },
] };
function record(id = "mp-test1", overrides: Partial<HubRecord> = {}): HubRecord {
  return { id, formula: "Li2O", composition: { Li: 2, O: 1 }, values: { "band-gap": 2, "formation-energy": -2, "energy-above-hull": 0 },
    units: { "band-gap": "eV", "formation-energy": "eV/atom", "energy-above-hull": "eV/atom" }, source: "MP-DFT", fidelity: "low-dft", methodMeta: "Synthetic calculation fixture", cohort: "test-cohort", provenance: { ...provenance }, structure, ...overrides };
}
function pair(index: number): FidelityPair {
  return { id: `pair-${index}`, formula: `Li${index + 1}O`, composition: { Li: index + 1, O: 1 }, objective: "band-gap", unit: "eV", cohort: "same-condition",
    comparisonBasis: "Synthetic matched-observable fixture for grouped calibration tests", dft: { value: index, methodMeta: "test-DFT", provenance: { ...provenance } },
    experiment: { value: index + 2, methodMeta: "test-experiment", provenance: { ...provenance } } };
}
const request = (url: string, options = {}) => axios.request({ url, proxy: false, validateStatus: () => true, ...options });

test("query contracts distinguish included/excluded elements, exact systems and invalid input", () => {
  assert.equal(parseHubQuery({ elements: "Pr,Ba,Co,O", match: "exact" }).elements, "Ba,Co,O,Pr");
  for (const invalid of [{ elements: "Xx" }, { elements: "Li,O", exclude_elements: "O" }, { elements: ["Li", "O"] }, { match: "exact" }, { source: "mp-live" }, { objective: "toString" }, { objective: "__proto__" }, { limit: "5001" }, { limit: "0" }, { limit: ["1", "2"] }]) assert.throws(() => parseHubQuery(invalid));
});

test("observation import rejects missing units/provenance, placeholders, incompatible labels and bad structures", () => {
  assert.equal(validateHubRecord(record()).fidelity, "low-dft");
  for (const row of [record("a", { units: { "band-gap": "mV" } }), record("a", { provenance: undefined }), record("a", { fidelity: "high-exp" }),
    record("a", { values: { "band-gap": NaN } }), record("a", { provenance: { ...provenance, url: "https://doi.org/REPLACE_WITH_REAL_DOI" } }), record("a", { structure: { lattice: {} } }), record("a", { composition: { Xx: 1 } })]) assert.throws(() => validateHubRecord(row));
  assert.throws(() => validatePair({ ...pair(1), unit: "mV" }));
  assert.throws(() => validatePair({ ...pair(1), comparisonBasis: "" }));
  const silicon = { ...structure, sites: [{ species: [{ element: "Si", occu: 1 }], abc: [0, 0, 0] }] };
  assert.throws(() => validateHubRecord(record("mp-mismatch", { structure: silicon })), /组成/);
  assert.throws(() => validatePair({ ...pair(1), structure: silicon }), /组成/);
});

test("SQLite snapshots persist, retain exact historical structure revisions and empty experiment collections", t => {
  const directory = mkdtempSync(join(tmpdir(), "ai4s-hub-test-"));
  let store = new HubStore(join(directory, "hub.db"));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  assert.deepEqual(store.catalog().sources.map(s => s.count), [0, 0, 0]);
  store.import("mp-snapshot", [record()], true);
  const first = store.select("mp-snapshot", DEFAULT_HUB_QUERY);
  store.import("mp-snapshot", [record("mp-test1", { values: { "band-gap": 3 }, units: { "band-gap": "eV" } })], true);
  assert.equal(store.structure("mp-snapshot", "mp-test1", first.revisions[0])?.row.values["band-gap"], 2);
  assert.equal(store.select("mp-snapshot", DEFAULT_HUB_QUERY).data[0].values["band-gap"], 3);
  store.close(); store = new HubStore(join(directory, "hub.db"));
  assert.deepEqual(store.catalog().sources.map(s => s.count), [1, 0, 0]);
  assert.equal(store.select("mp-snapshot", { ...DEFAULT_HUB_QUERY, excludeElements: "Li" }).data.length, 0);
});

test("imports are atomic and cannot overwrite a previous observation or silently mix conditions", t => {
  const store = new HubStore(":memory:"); t.after(() => store.close());
  const first = record("cat-1", { source: "Catalysis-Hub", cohort: "650C" });
  store.import("catalysis-hub", [first]);
  assert.throws(() => store.import("catalysis-hub", [record("cat-2", { source: "Catalysis-Hub" }), first]));
  assert.equal(store.catalog().sources.find(s => s.id === "catalysis-hub")!.count, 1);
  store.import("catalysis-hub", [record("cat-3", { source: "Catalysis-Hub", cohort: "750C" })]);
  assert.throws(() => store.select("catalysis-hub", { ...DEFAULT_HUB_QUERY, source: "catalysis-hub" }));
  assert.equal(store.select("catalysis-hub", { ...DEFAULT_HUB_QUERY, source: "catalysis-hub", cohort: "650C" }).data.length, 1);
});

test("10-group calibration uses only calibration labels, groups replicas and reports independent holdout honestly", () => {
  const rows = Array.from({ length: 15 }, (_, i) => pair(i));
  const result = calibratePairs(rows, "band-gap", "same-condition");
  assert.equal(result.correction, 2); assert.equal(result.calibrationGroups, 10); assert.equal(result.validationGroups, 5);
  assert.deepEqual(result.validation, { baselineMAE: 2, correctedMAE: 0 });
  const edited = structuredClone(rows);
  edited.filter(p => result.validationIds.includes(p.id)).forEach(p => { p.experiment.value += 100; });
  assert.equal(calibratePairs(edited, "band-gap", "same-condition").correction, 2);
  assert.equal(calibratePairs(rows.slice(0, 10), "band-gap", "same-condition").validation, null);
  assert.throws(() => calibratePairs([...rows.slice(0, 9), { ...pair(0), id: "replica", composition: { Li: 10, O: 10 } }], "band-gap", "same-condition"));
  const result2 = calibratePairs([...rows, { ...pair(0), id: "replica" }], "band-gap", "same-condition");
  assert.equal(result2.calibrationGroups + result2.validationGroups, 15);
});

test("minimization keeps raw target units and chooses the lower candidate with nonnegative regret", async () => {
  const rows = [5, 3, 1, 8].map((value, index) => material(index, { trueProperty: value, features: [value], cost: 1 }));
  const model = { train() {}, predict(point: { features: number[] }) { return { mean: point.features[0], std: 0 }; } };
  const config = { totalBudget: 3, batchSize: 1, initialSamples: 1, strategy: "UCB" as const, direction: "min" as const, random: () => 0 };
  const first = await runActiveLearningStep(rows, state(), config, model);
  assert.equal(first.state.bestValue, 5); assert.equal(first.state.history[0].regret, 4);
  const second = await runActiveLearningStep(first.pool, first.state, config, model);
  assert.equal(second.state.bestValue, 1); assert.equal(second.state.history.at(-1)!.regret, 0);
  assert.equal(second.pool.find(m => m.trueProperty === 1)?.isSampled, true);
  const candidate = material(0, { predictedMean: 1, predictedStd: 0, cost: 1 });
  assert.equal(AcquisitionFunction.compute(candidate, "EI", 3, 2, false, () => 0, "min"), 2);
  assert.equal(AcquisitionFunction.compute(candidate, "UCB", 3, 2, false, () => 0, "min"), -1);
});

test("live MP requests all targets and structures, applies arbitrary exact systems and stores snapshots", async t => {
  const hub = new HubStore(":memory:"); t.after(() => hub.close());
  let upstreamQuery: URLSearchParams;
  const upstream = await listen(t, http.createServer((req, res) => {
    upstreamQuery = new URL(req.url!, "http://fixture").searchParams;
    json(res, { data: [{ material_id: "mp-test1", formula_pretty: "Li2O", composition: { Li: 2, O: 1 }, band_gap: 2, formation_energy_per_atom: -2, energy_above_hull: 0, structure }], meta: { db_version: "fixture-db" } });
  }));
  const network = createNetworkClient({ proxyResolver: () => "" }); t.after(() => network.close());
  const base = await listen(t, http.createServer(createApiApp({ network, hub, env: { MP_API_KEY: "test-only-key" }, materialsEndpoint: upstream })));
  const response = await request(`${base}/api/hub/materials?source=mp-live&objective=formation-energy&elements=Li,O&exclude_elements=Au,Pt&match=exact&limit=2`);
  assert.equal(response.status, 200); assert.equal(response.data.meta.effectiveSource, "mp-live");
  assert.equal(upstreamQuery!.get("chemsys"), "Li-O"); assert.equal(upstreamQuery!.get("elements"), null);
  assert.equal(upstreamQuery!.get("exclude_elements"), "Au,Pt"); assert.equal(upstreamQuery!.get("license"), "BY-C");
  for (const field of ["structure", "symmetry", "energy_above_hull", "formation_energy_per_atom", "band_gap"]) assert.ok(upstreamQuery!.get("_fields")!.split(",").includes(field));
  assert.equal(response.data.data[0].values["formation-energy"], -2);
  assert.equal(response.data.data[0].provenance.datasetVersion, "fixture-db");
  assert.equal(hub.catalog().sources[0].count, 1);
  const offline = await request(`${base}/api/hub/materials?source=mp-snapshot&objective=energy-above-hull&limit=2`);
  assert.equal(offline.data.data[0].values["energy-above-hull"], 0);
  const revision = offline.data.data[0].revision;
  const geometry = await request(`${base}/api/hub/structure?dataset=mp-snapshot&id=mp-test1&revision=${revision}`);
  assert.equal(geometry.status, 200); assert.equal(geometry.data.data.structure.sites.length, 3);
});

test("offline and failed-live modes never fabricate Mock records; empty curated sources stay empty", async t => {
  const hub = new HubStore(":memory:"); t.after(() => hub.close()); hub.import("mp-snapshot", [record()], true);
  let requests = 0;
  const upstream = await listen(t, http.createServer((_req, res) => { requests++; json(res, { error: "denied" }, 403); }));
  const network = createNetworkClient({ proxyResolver: () => "" }); t.after(() => network.close());
  const base = await listen(t, http.createServer(createApiApp({ network, hub, env: {}, materialsEndpoint: upstream })));
  const offline = await request(`${base}/api/hub/materials?source=mp-snapshot`);
  assert.equal(requests, 0); assert.equal(offline.data.data[0].source, "MP-DFT");
  const fallback = await request(`${base}/api/hub/materials?source=mp-live&elements=Li,O`);
  assert.equal(fallback.data.meta.fallbackReason, "MISSING_API_KEY"); assert.equal(fallback.data.meta.effectiveSource, "mp-snapshot");
  assert.equal(requests, 0);
  for (const source of ["catalysis-hub", "dual-fidelity"]) {
    const empty = await request(`${base}/api/hub/materials?source=${source}`);
    assert.equal(empty.status, 200); assert.deepEqual(empty.data.data, []);
  }
  const keyed = await listen(t, http.createServer(createApiApp({ network, hub, env: { MP_API_KEY: "test-key" }, materialsEndpoint: upstream })));
  const denied = await request(`${keyed}/api/hub/materials?source=mp-live&elements=Li,O`);
  assert.equal(denied.data.meta.fallbackReason, "ACCESS_DENIED"); assert.equal(denied.data.data.length, 1);
});

test("hub API validates import transaction, rejects cross-origin writes and never accepts a template as observations", async t => {
  const hub = new HubStore(":memory:"); t.after(() => hub.close());
  const network = createNetworkClient({ proxyResolver: () => "" }); t.after(() => network.close());
  const base = await listen(t, http.createServer(createApiApp({ network, hub, env: {} })));
  const template = await request(`${base}/api/hub/template?dataset=catalysis-hub`);
  assert.equal((await request(`${base}/api/hub/import`, { method: "POST", data: template.data })).status, 400);
  const payload = { dataset: "catalysis-hub", records: [record("cat-test", { source: "Catalysis-Hub" })] };
  assert.equal((await request(`${base}/api/hub/import`, { method: "POST", headers: { Origin: "https://untrusted.invalid" }, data: payload })).status, 403);
  assert.equal((await request(`${base}/api/hub/import`, { method: "POST", data: payload })).data.imported, 1);
  assert.equal((await request(`${base}/api/hub/import`, { method: "POST", data: payload })).status, 400);
  assert.equal((await request(`${base}/api/hub/materials?objective=constructor`)).status, 400);
});

test("Data Hub engine exposes fidelity/units/source and cannot auto-generate labels on a failed request", async t => {
  const hub = new HubStore(":memory:"); t.after(() => hub.close()); hub.import("mp-snapshot", [record()], true);
  const query = { ...DEFAULT_HUB_QUERY, objective: "formation-energy" as const };
  const selected = hub.select("mp-snapshot", query);
  const response: HubResponse = { data: selected.data.map((row, i) => ({ ...row, revision: selected.revisions[i] })), meta: { requestedSource: query.source, effectiveSource: query.source,
    objective: query.objective, query, total: 1, datasetVersion: selected.datasetVersion, fetchedAt: selected.fetchedAt, excludedMissingTarget: 0 } };
  t.mock.method(axios, "get", async () => ({ data: response }));
  const engine = new MaterialsEngine();
  await engine.loadHubData(query);
  assert.equal(engine.getPool()[0].trueProperty, -2); assert.equal(engine.getPool()[0].features.length, 22);
  assert.equal(engine.getPool()[0].source, "MP-DFT"); assert.equal(engine.getPool()[0].fidelity, "low-dft");
  assert.equal(engine.getPool()[0].cohort, "test-cohort");
  assert.equal(engine.getPool()[0].structureRef?.revision, selected.revisions[0]);
  t.mock.method(axios, "get", async () => { throw new Error("offline"); });
  await assert.rejects(engine.loadHubData(query)); assert.deepEqual(engine.getPool(), []);
});

test("advisor follows minimization, source and units while withholding unsampled high-fidelity labels", () => {
  const query = { ...DEFAULT_HUB_QUERY, source: "dual-fidelity" as const, objective: "formation-energy" as const };
  const rows = [material(1, { source: "Lab-Experiment", fidelity: "high-exp", cohort: "650C", comparisonBasis: "Matched observable", trueProperty: -1, isSampled: true }),
    material(2, { source: "Lab-Experiment", fidelity: "high-exp", trueProperty: -3, isSampled: true }), material(3, { trueProperty: 98765, source: "Lab-Experiment" })];
  const context = buildAdvisorContext({ pool: rows, state: state(), strategy: "UCB", batchSize: 2, totalBudget: 50, isRealData: true, runId: 1, modelConfig: DEFAULT_MODEL_CONFIG,
    hubMetadata: { requestedSource: query.source, effectiveSource: query.source, objective: query.objective, query, total: 3, datasetVersion: "fixture", fetchedAt: provenance.retrievedAt, excludedMissingTarget: 0 } }, rows[2].id);
  assert.equal(context.best_observed_material?.observed_value, -3); assert.equal(context.objective.unit, "eV/atom");
  assert.equal(context.selected_material?.source, "Lab-Experiment"); assert.ok(!JSON.stringify(context).includes("98765"));
  assert.match(context.learning.score_formula, /-mu/);
  assert.deepEqual(context.dataset.cohorts, ["650C"]);
  assert.equal(context.best_observed_material?.source, "Lab-Experiment");
});

test("local structure cache is keyed by dataset and revision, and Mock cannot acquire structure provenance", async t => {
  const first = "a".repeat(64), second = "b".repeat(64), calls: string[] = [];
  t.mock.method(axios, "get", async (url: string) => {
    const params = new URL(url, "http://fixture").searchParams;
    calls.push(url); return { data: { data: { material_id: "cat-1", formula_pretty: "Li2O", structure }, meta: { materialId: "cat-1", fetchedAt: provenance.retrievedAt, cached: true, dataset: params.get("dataset"), revision: params.get("revision") } } };
  });
  const service = new MaterialStructureService();
  const base = { id: "cat-1", source: "Catalysis-Hub" as const, structureRef: { dataset: "catalysis-hub" as const, id: "cat-1", revision: first } };
  assert.equal((await service.get(base)).kind, "ready"); await service.get(base);
  await service.get({ ...base, structureRef: { ...base.structureRef, revision: second } });
  assert.equal(calls.length, 2); assert.ok(calls[1].includes(second));
  assert.equal((await service.get({ ...base, source: "mock" })).kind, "unavailable");
});

test("failed real hub loading remains the requested physical source/objective in advisor context", () => {
  const query = { ...DEFAULT_HUB_QUERY, objective: "formation-energy" as const };
  const context = buildAdvisorContext({ pool: [], state: state(), strategy: "EI", batchSize: 2, totalBudget: 50, isRealData: false, runId: 1,
    modelConfig: DEFAULT_MODEL_CONFIG, hubQuery: query, hubLoadState: "error" });
  assert.equal(context.dataset.source, "mp-snapshot"); assert.equal(context.dataset.status, "error");
  assert.equal(context.objective.direction, "min"); assert.equal(context.objective.unit, "eV/atom");
  assert.match(context.objective.evidence, /no synthetic labels/); assert.deepEqual(context.top_candidates, []);
});

test("paired DFT structure retains DFT provenance instead of experimental measurement provenance", async t => {
  const hub = new HubStore(":memory:"); t.after(() => hub.close());
  const paired = { ...pair(1), structure, experiment: { ...pair(1).experiment, provenance: { ...provenance, url: "https://fixtures.invalid/experiment", retrievedAt: "2026-10-29T00:00:00Z" } } };
  hub.import("dual-fidelity", [paired]);
  const network = createNetworkClient({ proxyResolver: () => "" }); t.after(() => network.close());
  const base = await listen(t, http.createServer(createApiApp({ network, hub, env: {} })));
  const data = await request(`${base}/api/hub/materials?source=dual-fidelity&cohort=same-condition`);
  assert.equal(data.data.data[0].provenance.url, paired.experiment.provenance.url);
  assert.equal(data.data.data[0].comparisonBasis, paired.comparisonBasis);
  const geometry = await request(`${base}/api/hub/structure?dataset=dual-fidelity&id=pair-1&revision=${data.data.data[0].revision}`);
  assert.equal(geometry.status, 200);
  assert.equal(geometry.data.meta.provenance.url, paired.dft.provenance.url);
  assert.equal(geometry.data.meta.fetchedAt, paired.dft.provenance.retrievedAt);
});
