import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePresentationPreset, presentationFront, presentationReport } from "../src/demo/presentation";
import { materialRecordKey } from "../src/materialContext";

const load = () => validatePresentationPreset(JSON.parse(readFileSync(new URL("../src/demo/presentation-preset.json", import.meta.url), "utf8")));

test("presentation archive has 20 coherent rounds and a formula fitted to the same observed MP records", () => {
  const p = load(), learning = p.learning;
  assert.equal(learning.state.iteration, 20);
  assert.equal(learning.state.history.length, 20);
  assert.equal(learning.state.sampledCount, 24);
  assert.deepEqual(learning.state.history.map(h => h.iteration), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.equal(learning.state.bestValue, Math.max(...learning.pool.filter(m => m.isSampled).map(m => m.trueProperty)));
  const samples = new Map(learning.pool.filter(m => m.isSampled).map(m => [m.id, m]));
  assert.equal(learning.formula.sourceSnapshot.samples.length, samples.size);
  for (const row of learning.formula.sourceSnapshot.samples) {
    const material = samples.get(row.id)!;
    assert.equal(row.label, material.trueProperty);
    assert.equal(row.lineage?.recordKey, materialRecordKey(material));
  }
  for (const row of learning.formula.sourceSnapshot.queries) {
    assert.equal("label" in row, false);
    assert.equal("trueProperty" in row, false);
  }
  assert.equal(learning.formula.objective, "band-gap");
  assert.equal(learning.formula.sourceSnapshot.objectiveMeta?.unit, "eV");
});

test("presentation archive retains both original MACE identities, force convergence and original trajectories", () => {
  const p = load(), reference = p.umlip.reference;
  assert.equal(p.umlip.sourceRunId, "dfce2840-6f79-489e-bb5f-3542af7c48b4");
  assert.equal(p.umlip.sourceConverged, 4);
  assert.deepEqual(p.umlip.candidates.map(c => c.id), ["demo-0", "demo-4"]);
  for (const c of p.umlip.candidates) {
    assert.equal(c.status, "converged");
    assert.ok(c.result!.maxForceEvAngstrom <= p.umlip.fmax);
    assert.ok(Math.abs(c.result!.energyEv / c.structure.elements.length - c.result!.energyPerAtomEv) < 1e-10);
    assert.ok(Math.abs(c.result!.energyPerAtomEv - reference.energyPerAtomEv - c.relativeEnergyPerAtomEv!) < 1e-12);
    const trajectory = c.trajectory.trim().split("\n").map(line => JSON.parse(line));
    assert.ok(trajectory.length > 0);
    assert.ok(Math.abs(trajectory.at(-1).energyEv - c.result!.energyEv) < 1e-10);
    assert.equal(c.crystal.sites.length, c.structure.elements.length);
  }
});

test("presentation XRD contains actual complete fit arrays and preserves its demonstration origin", () => {
  const p = load(), x = p.xrd;
  assert.equal(x.demo, true);
  assert.match(x.result.engine, /pymatgen/);
  assert.equal(x.comparison.passed, true);
  assert.ok(x.comparison.score >= 99);
  assert.equal(x.comparison.shift, .04);
  assert.equal(x.comparison.observed.length, x.comparison.fitted.length);
  assert.equal(x.comparison.observed.length, x.comparison.residual.length);
  assert.ok(x.comparison.observed.length > 1000);
  assert.equal("feedback" in x, false);
  assert.match(p.advisor.source, /Codex/);
});

test("presentation replay and exported report cannot reveal future or unused observations", () => {
  const p = load(), before = JSON.stringify(p);
  for (const round of [1, 7, p.pareto.state.round]) {
    const view = presentationFront(p, round, [90, 7, 3]);
    assert.ok(view.pool.every(c => c.observedAt! <= round));
    assert.ok(view.history.every(h => h.round <= round));
    assert.ok(view.front.every(c => view.pool.includes(c)));
    if (round === 1) assert.equal(view.pool.length, 6);
  }
  const full = presentationFront(p, p.pareto.state.round, [35, 15, 50]);
  assert.equal(full.pool.length, 20);
  assert.ok(Math.abs(full.gain - 31.58646113212118) < 1e-8);
  const report = presentationReport(p);
  assert.ok(report.learning.sampled.every(m => m.isSampled));
  assert.ok(report.pareto.pool.every(c => c.observed));
  assert.equal(report.pareto.pool.length, 20);
  assert.equal(JSON.stringify(p), before);
});

test("incomplete or unconverged archives fail instead of presenting a completed state", () => {
  const bad = load(); bad.umlip.candidates[0].status = "unconverged";
  assert.throws(() => validatePresentationPreset(bad), /不完整/);
  const stale = load(); stale.learning.formula.iteration = 19;
  assert.throws(() => validatePresentationPreset(stale), /不完整/);
});
