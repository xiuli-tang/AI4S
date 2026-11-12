import type { Material } from "../types";
import type { ObjectiveId } from "../dataHub";
import type { ParetoArchive } from "./types";
import { hubParetoCandidates } from "../engine/pareto/ParetoData";
import { hypervolume, paretoFront, type ParetoCandidate, type Weights, type ObjectiveScales, type ParetoProblem } from "../engine/pareto/ParetoEngine";
import { materialRecordKey } from "../materialContext";
import { normalizeSamplingBudget } from "../engine/RandomComparison";

export function synchronizeDecisionObservations(candidates: ParetoCandidate[], materials: Material[], weights: Weights, scales: ObjectiveScales, problem?: ParetoProblem) {
  const sampled = new Map(materials.filter(m => m.isSampled).map(m => [materialRecordKey(m), m.iteration ?? 0]));
  const pool = candidates.map(c => ({ ...c, observed: sampled.has(c.lineage?.recordKey ?? ""), observedAt: sampled.get(c.lineage?.recordKey ?? "") }));
  const round = Math.max(0, ...materials.filter(m => m.isSampled).map(m => m.iteration ?? 0));
  return { pool, state: { round, history: sampled.size ? [{ round, observed: pool.filter(c => c.observed).length,
    hypervolume: hypervolume(pool, scales, problem), frontierIds: paretoFront(pool, problem).map(c => c.id),
    addedIds: pool.filter(c => c.observed).map(c => c.id), weights }] : [] } };
}
/** One shared set of observations feeds the report's performance/stability/price decision. */
export function sharedDecisionArchive(materials: Material[], primary: ObjectiveId, seed: number, previous?: ParetoArchive | null): ParetoArchive {
  const secondary = primary !== "energy-above-hull" && materials.some(m => m.objectiveValues?.["energy-above-hull"] != null) ? "energy-above-hull" : null;
  const dataset = hubParetoCandidates(materials, primary, secondary, previous?.prices ?? {}, previous?.externalStability ?? []);
  const sampled = new Map(materials.filter(m => m.isSampled).map(m => [materialRecordKey(m), m.iteration ?? 0]));
  const pool = dataset.candidates.map(c => ({ ...c, observed: sampled.has(c.lineage!.recordKey), observedAt: sampled.get(c.lineage!.recordKey) }));
  const weights = previous?.weights ?? [50, 25, 25], round = Math.max(0, ...materials.filter(m => m.isSampled).map(m => m.iteration ?? 0));
  return { workflowShared: true, mode: "materials-project", weights, budget: normalizeSamplingBudget(previous?.budget || 50, materials.length, materials.filter(m => m.isSampled).length), seed, strategy: "ParEGO",
    prices: previous?.prices ?? {}, externalStability: previous?.externalStability ?? [], secondary: secondary ?? "none", problem: dataset.problem,
    pool, state: { round, history: sampled.size ? [{ round, observed: pool.filter(c => c.observed).length,
      hypervolume: hypervolume(pool, dataset.scales, dataset.problem), frontierIds: paretoFront(pool, dataset.problem).map(c => c.id),
      addedIds: pool.filter(c => c.observed).map(c => c.id), weights }] : [] }, replay: null };
}
