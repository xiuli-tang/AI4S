import { AcquisitionFunction } from "../AcquisitionFunction";
import { createSeededRandom } from "../SeededRandom";
import type { FeaturePoint, TrainingPoint } from "../SurrogateModel";
import type { Prediction } from "../models/regressors";
import type { MaterialLineage } from "../../materialContext";
import type { StabilityInput } from "./ParetoData";
import { constrainAcquisition } from "../../synthesis/feedback";
import type { ObjectiveDirection, ObjectiveId } from "../../dataHub";

export type Objectives = [performance: number, hullEvAtom: number, priceUsdKg: number];
export type Weights = [number, number, number];
export interface ParetoAxis { id: string; zh: string; en: string; unit: string; direction: ObjectiveDirection; reference: number; scale: number; log?: boolean }
export interface ParetoProblem { axes: [ParetoAxis, ParetoAxis, ParetoAxis]; active: (0 | 1 | 2)[]; useSynthesisPrior: boolean }
export interface ParetoCandidate {
  id: string; formula: string; composition: Record<string, number>; features: number[];
  objectives: Objectives; observed: boolean; observedAt?: number;
  source: "demo" | "materials-project" | "data-hub"; stabilitySource: string; priceQuality: "reference" | "scenario";
  lineage?: MaterialLineage;
  objective?: { id: ObjectiveId; unit: string; direction: ObjectiveDirection };
  stabilityProvenance?: StabilityInput;
  synthesisPrior?: number;
  synthesisStatus?: "pass" | "impurity";
}
export interface ObjectiveScales { performance: number; hull: number; price: number }
export interface ParetoRound {
  round: number; observed: number; hypervolume: number; frontierIds: string[];
  addedIds: string[]; weights: Weights;
}
export interface ParetoState { round: number; history: ParetoRound[] }
export interface ParetoSurrogate {
  train(data: TrainingPoint[]): void | Promise<void>;
  predictBatch(data: FeaturePoint[]): Prediction[] | Promise<Prediction[]>;
}
export const INITIAL_PARETO_STATE = (): ParetoState => ({ round: 0, history: [] });

export function normalizeWeights(weights: Weights): Weights {
  if (weights.length !== 3 || weights.some(w => !Number.isFinite(w) || w < 0)) throw new RangeError("Three nonnegative preference weights required");
  const largest = Math.max(...weights);
  if (largest === 0) return [1 / 3, 1 / 3, 1 / 3];
  const scaled = weights.map(w => w / largest);
  const sum = scaled.reduce((a, b) => a + b, 0);
  return scaled.map(w => w / sum) as Weights;
}
export function validateObjectives(y: Objectives, problem?: ParetoProblem) {
  if (y.length !== 3 || y.some(v => !Number.isFinite(v)) || y[2] < 0 || (!problem || problem.axes[1].id === "energy-above-hull") && y[1] < 0) throw new RangeError("Invalid objective vector");
}
export function utilities(y: Objectives, scales: ObjectiveScales, problem?: ParetoProblem): Objectives {
  validateObjectives(y, problem);
  if (problem) return y.map((v, i) => {
    if (!problem.active.includes(i as 0 | 1 | 2)) return 1;
    const a = problem.axes[i];
    if (!Number.isFinite(a.reference) || !Number.isFinite(a.scale) || a.scale <= 0) throw new RangeError("Invalid objective scale");
    return a.log ? 1 - Math.log1p(v) / Math.log1p(a.scale) : (a.direction === "min" ? a.reference - v : v - a.reference) / a.scale;
  }) as Objectives;
  if (Object.values(scales).some(v => !Number.isFinite(v) || v <= 0)) throw new RangeError("Positive fixed objective scales required");
  return [y[0] / scales.performance, 1 - y[1] / scales.hull, 1 - Math.log1p(y[2]) / Math.log1p(scales.price)];
}
export function dominates(a: Objectives, b: Objectives, problem?: ParetoProblem): boolean {
  validateObjectives(a, problem); validateObjectives(b, problem);
  if (problem) return problem.active.every(i => problem.axes[i].direction === "max" ? a[i] >= b[i] : a[i] <= b[i])
    && problem.active.some(i => a[i] !== b[i]);
  return a[0] >= b[0] && a[1] <= b[1] && a[2] <= b[2]
    && (a[0] > b[0] || a[1] < b[1] || a[2] < b[2]);
}
/** Only acquired observations enter the empirical frontier. */
export function paretoFront(candidates: ParetoCandidate[], problem?: ParetoProblem): ParetoCandidate[] {
  const observed = candidates.filter(c => c.observed);
  observed.forEach(c => validateObjectives(c.objectives, problem));
  return observed.filter(c => !observed.some(other => other !== c && dominates(other.objectives, c.objectives, problem)));
}
/** Maximize negative augmented Tchebycheff distance to a fixed utility ideal. */
export function scalarize(y: Objectives, weights: Weights, scales: ObjectiveScales, problem?: ParetoProblem): number {
  let effective = problem ? weights.map((v, i) => problem.active.includes(i as 0 | 1 | 2) ? v : 0) as Weights : weights;
  if (problem && effective.every(v => v === 0)) effective = [0, 1, 2].map(i => problem.active.includes(i as 0 | 1 | 2) ? 1 : 0) as Weights;
  const w = normalizeWeights(effective), u = utilities(y, scales, problem);
  const distances = u.map((value, i) => w[i] * (1 - value));
  return -Math.max(...distances) - 0.05 * distances.reduce((a, b) => a + b, 0);
}
export function feasibleCandidate(c: ParetoCandidate, problem?: ParetoProblem) { return !problem?.useSynthesisPrior || c.synthesisStatus !== "impurity" && (c.synthesisPrior ?? 1) >= .25; }
export function preferredCandidate(candidates: ParetoCandidate[], weights: Weights, scales: ObjectiveScales, problem?: ParetoProblem) {
  const score = (c: ParetoCandidate) => constrainAcquisition(scalarize(c.objectives, weights, scales, problem), problem?.useSynthesisPrior ? c.synthesisPrior ?? 1 : 1);
  return [...paretoFront(candidates.filter(c => feasibleCandidate(c, problem)), problem)].sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id))[0];
}
/** Exact union of origin-anchored boxes in 3D, with fixed scales and reference (0,0,0). */
export function hypervolume(candidates: ParetoCandidate[], scales: ObjectiveScales, problem?: ParetoProblem): number {
  const points = paretoFront(candidates, problem).map(c => utilities(c.objectives, scales, problem)).filter(p => p.every(v => v > 0));
  const xs = [...new Set([0, ...points.map(p => p[0])])].sort((a, b) => a - b);
  let volume = 0;
  for (let i = 1; i < xs.length; i++) {
    const active = points.filter(p => p[0] >= xs[i]);
    const ys = [...new Set([0, ...active.map(p => p[1])])].sort((a, b) => a - b);
    let area = 0;
    for (let j = 1; j < ys.length; j++) area += (ys[j] - ys[j - 1]) * Math.max(0, ...active.filter(p => p[1] >= ys[j]).map(p => p[2]));
    volume += (xs[i] - xs[i - 1]) * area;
  }
  return volume;
}

export async function runParetoStep(pool: ParetoCandidate[], state: ParetoState,
  config: { budget: number; weights: Weights; scales: ObjectiveScales; seed: number; signal?: AbortSignal; strategy?: "ParEGO" | "Random"; problem?: ParetoProblem },
  model: ParetoSurrogate): Promise<{ pool: ParetoCandidate[]; state: ParetoState; done: boolean }> {
  config.signal?.throwIfAborted();
  if (!Number.isSafeInteger(config.budget) || config.budget < 1 || config.budget > 200 || !Number.isSafeInteger(config.seed) || config.seed < 0 || config.seed > 0xffffffff) throw new RangeError("Invalid budget or seed");
  if (new Set(pool.map(c => c.id)).size !== pool.length) throw new RangeError("Candidate IDs must be unique");
  const preference = normalizeWeights(config.weights);
  const acquired = pool.filter(c => c.observed).length;
  if (acquired >= Math.min(config.budget, pool.length)) return { pool, state, done: true };
  const next = pool.map(c => ({ ...c }));
  if (!next.some(c => !c.observed && feasibleCandidate(c, config.problem))) return { pool, state, done: true };
  const random = createSeededRandom((config.seed + Math.imul(state.round, 2654435761)) >>> 0);
  const draws = preference.map(p => -Math.log(Math.max(random(), 1e-12)) * (0.25 + p)) as Weights;
  const weights = normalizeWeights(draws);
  const added: ParetoCandidate[] = [];
  if (acquired === 0) {
    const remaining = next.filter(c => feasibleCandidate(c, config.problem));
    const count = Math.min(6, config.budget, remaining.length);
    const anchors = remaining.filter(c => Object.values(c.composition).filter(n => n > 0).length === 1);
    for (let i = anchors.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1)); [anchors[i], anchors[j]] = [anchors[j], anchors[i]];
    }
    for (let i = 0; i < count; i++) {
      const index = i < anchors.length ? remaining.indexOf(anchors[i]) : Math.floor(random() * remaining.length);
      const [candidate] = remaining.splice(index, 1);
      added.push(candidate);
    }
  } else if (config.strategy === "Random") {
    const candidates = next.filter(c => !c.observed && feasibleCandidate(c, config.problem));
    added.push(candidates[Math.floor(random() * candidates.length)]);
  } else {
    const training = next.filter(c => c.observed).map(c => ({ features: c.features, trueProperty: scalarize(c.objectives, weights, config.scales, config.problem) }));
    await model.train(training);
    config.signal?.throwIfAborted();
    const candidates = next.filter(c => !c.observed && feasibleCandidate(c, config.problem));
    const predictions = await model.predictBatch(candidates.map(c => ({ features: c.features })));
    config.signal?.throwIfAborted();
    if (predictions.length !== candidates.length) throw new Error("Prediction count does not match candidates");
    const best = Math.max(...training.map(p => p.trueProperty));
    let winner = 0, highest = -Infinity;
    predictions.forEach((p, i) => {
      if (!Number.isFinite(p.mean) || !Number.isFinite(p.std) || p.std < 0) throw new Error("Invalid ParEGO prediction");
      const value = constrainAcquisition(AcquisitionFunction.computeParEGO(p, best), config.problem?.useSynthesisPrior ? candidates[i].synthesisPrior ?? 1 : 1);
      if (value > highest) { highest = value; winner = i; }
    });
    added.push(candidates[winner]);
  }
  config.signal?.throwIfAborted();
  for (const candidate of added) { validateObjectives(candidate.objectives, config.problem); candidate.observed = true; candidate.observedAt = state.round + 1; }
  const record: ParetoRound = { round: state.round + 1, observed: next.filter(c => c.observed).length,
    hypervolume: hypervolume(next, config.scales, config.problem), frontierIds: paretoFront(next, config.problem).map(c => c.id), addedIds: added.map(c => c.id), weights };
  return { pool: next, state: { round: record.round, history: [...state.history, record] }, done: record.observed >= Math.min(config.budget, next.length) };
}
