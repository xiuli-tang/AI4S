import type { ResearchModules } from "./types";
import { paretoFront, preferredCandidate } from "../engine/pareto/ParetoEngine";
import { PARETO_SCALES } from "../engine/pareto/ParetoData";

/** Bounded module summaries for the advisor; no candidate oracle pool or raw trajectories. */
export function researchEvidence(modules: ResearchModules, recordKey?: string | null) {
  const f = modules.formula?.result, p = modules.pareto, run = modules.umlip?.run;
  const observed = p?.pool.filter(c => c.observed && (c.observedAt ?? 0) <= (p.replay ?? p.state.round)) ?? [];
  const selected = p ? preferredCandidate(observed, p.weights, PARETO_SCALES[p.mode], p.problem) : undefined;
  const query = recordKey ? f?.sourceSnapshot.queries.find(q => q.lineage?.recordKey === recordKey) : undefined;
  const point = query ? f?.points.find(p => p.id === query.id) : undefined;
  return {
    formula: f ? { snapshot_id: f.snapshotId, objective: f.objective, target: f.target, iteration: f.iteration, target_unit: f.sourceSnapshot.objectiveMeta?.unit,
      intercept: f.intercept, terms: f.formulas.map(t => ({ text: t.text, coefficient: t.coefficient, expression_unit: t.unit,
        coefficient_unit: `${f.sourceSnapshot.objectiveMeta?.unit ?? "target"}/(${t.unit})` })),
      selected_projection: point ? { id: point.id, record_key: recordKey, coordinates: [point.x, point.y], predicted_value: point.prediction,
        observed_value: point.observed, value_origin: query?.lineage?.source, partition: point.partition } : null,
      metrics: f.metrics, groups: { discovery: f.split.discovery.length, tuning: f.split.tuning.length, test: f.split.test.length },
      sampled_records: f.sampledRecords, source_records: f.sourceSnapshot.samples.slice(0, 8).map(s => s.lineage?.recordKey) } : null,
    pareto: p ? { round: p.replay ?? p.state.round, problem: p.problem, weights: p.weights,
      observed: observed.length, selected_id: selected?.id, frontier: paretoFront(observed, p.problem).slice(0, 12).map(c => ({ id: c.id, formula: c.formula, objectives: c.objectives,
        record_key: c.lineage?.recordKey, price_quality: c.priceQuality, stability_source: c.stabilitySource, synthesis_prior: c.synthesisPrior })),
      latest_hypervolume: p.state.history.filter(h => h.round <= (p.replay ?? p.state.round)).at(-1)?.hypervolume } : null,
    umlip: run ? { run_id: run.id, status: run.status, model: run.model ? { label: run.model.label, sha256: run.model.sha256, device: run.model.device } : null,
      reference: run.reference, converged: run.candidates.filter(c => c.status === "converged").slice(0, 12).map(c => ({ id: c.id, name: c.name, origin: c.origin,
        structure_hash: modules.structures.find(a => a.stage === "relaxed" && a.runId === run.id && a.candidateId === c.id)?.structureHash ?? null,
        energy_eV_atom: c.result?.energyPerAtomEv, delta_eV_atom: c.relativeEnergyPerAtomEv, max_force_eV_A: c.result?.maxForceEvAngstrom, steps: c.result?.steps })) } : null,
    xrd: modules.experiments.filter(r => !recordKey || r.reference.binding?.recordKey === recordKey).slice(0, 6).map(r => ({ id: r.id, material_id: r.materialId, formula: r.formula, record_key: r.reference.binding?.recordKey,
      reference_binding: r.reference.binding,
      structure_hash: r.reference.binding?.structureHash, created_at: r.createdAt, source: r.demo ? "demonstration" : "user-uploaded",
      sample_id: r.feedback?.sampleId, temperature_C: r.temperature, atmosphere: r.atmosphere, preflight: r.reference.preflight,
      score: r.comparison.score, main_phase_fit_percent: r.comparison.mainFraction, peak_coverage_percent: r.comparison.peakCoverage,
      phases: r.comparison.phases, unmatched_peaks: r.comparison.unmatchedPeaks.slice(0, 8), shift_degrees: r.comparison.shift })),
    geometry: modules.geometry.filter(g => !recordKey || g.recordKey === recordKey).slice(-8).map(({ neighbors, ...r }) => ({ ...r, oxygen_neighbors: neighbors.length })),
    calibration: modules.calibration ? { ...modules.calibration, enabled: modules.calibrationEnabled } : null,
  };
}
