import { paretoFront, preferredCandidate, type Weights } from "../engine/pareto/ParetoEngine";
import type { PresentationPreset } from "./types";

export function validatePresentationPreset(value: unknown): PresentationPreset {
  const p = value as PresentationPreset;
  if (p?.schema !== "ai4s-presentation-1" || !p.id || p.learning?.state.iteration !== 20
    || p.learning.state.history.length !== 20 || p.learning.state.sampledCount !== p.learning.pool.filter(m => m.isSampled).length
    || p.learning.formula?.iteration !== 20 || !p.learning.formula.formulas.length
    || p.learning.formula.sampledRecords !== p.learning.state.sampledCount
    || p.umlip?.candidates.length !== 2 || !/^[a-f0-9]{64}$/.test(p.umlip.model.sha256)
    || p.umlip.candidates.some(c => c.status !== "converged" || !c.result?.converged
      || c.result.maxForceEvAngstrom > p.umlip.fmax || !c.poscar || !c.trajectory)
    || p.xrd?.demo !== true || !p.xrd.comparison.passed || p.xrd.comparison.score < 95
    || !p.advisor?.answer || p.pareto?.pool.filter(c => c.observed).length !== 20) {
    throw new Error("路演快照不完整，请重新生成档案。");
  }
  return p;
}

export function presentationFront(p: PresentationPreset, round: number, weights: Weights) {
  const history = p.pareto.state.history.filter(h => h.round <= round);
  const pool = p.pareto.pool.filter(c => c.observed && (c.observedAt ?? Infinity) <= round);
  const front = paretoFront(pool);
  const current = history.at(-1), first = p.pareto.state.history[0];
  return { pool, front, history, selected: preferredCandidate(pool, weights, p.pareto.scales),
    gain: current && first.hypervolume > 0 ? (current.hypervolume / first.hypervolume - 1) * 100 : 0 };
}

/** A shareable presentation report includes observations, never the unused oracle pool. */
export function presentationReport(p: PresentationPreset) {
  return { schema: p.schema, id: p.id, createdAt: p.createdAt, provenance: p.provenance,
    learning: { state: p.learning.state, sampled: p.learning.pool.filter(m => m.isSampled), formula: p.learning.formula },
    pareto: { ...p.pareto, pool: p.pareto.pool.filter(c => c.observed) }, umlip: p.umlip, xrd: p.xrd, advisor: p.advisor };
}
