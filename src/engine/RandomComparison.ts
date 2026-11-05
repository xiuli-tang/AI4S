import type { Material, ALState, RandomComparison } from "../types";
import { bestTarget, type ObjectiveDirection } from "../dataHub";
import { createSeededRandom } from "./SeededRandom";

/** A separate, uniform no-replacement replay. Cost, model predictions and priors never select its samples. */
export function extendRandomComparison(before: Material[], after: Material[], previous: RandomComparison | undefined,
  seed: number, direction: ObjectiveDirection): RandomComparison {
  const priorObservations = before.filter(m => m.isSampled);
  const initialIds = previous?.initialIds ?? (priorObservations.length ? priorObservations : after.filter(m => m.isSampled)).map(m => m.id);
  const initial = new Set(initialIds), random = createSeededRandom(seed);
  const remaining = after.filter(m => !initial.has(m.id)).map(m => m.id);
  for (let i = remaining.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
  }
  const order = [...initialIds, ...remaining], count = after.filter(m => m.isSampled).length;
  const selected = order.slice(0, count), values = new Map(after.map(m => [m.id, m.trueProperty]));
  const point = { sampledCount: count, bestValue: bestTarget(selected.map(id => values.get(id)!), direction), sampledIds: selected };
  return { schema: "uniform-label-replay-1", seed, initialIds,
    points: [...(previous?.points ?? []).filter(p => p.sampledCount < count), point] };
}

/** Post-hoc matched-target comparison, bounded to observed evaluation counts; negative savings are retained. */
export function comparisonSavings(state: ALState, direction: ObjectiveDirection) {
  const target = state.bestValue;
  const reaches = (value: number) => direction === "min" ? value <= target + 1e-9 : value >= target - 1e-9;
  if (!Number.isFinite(target) || !state.comparison) return null;
  const active = state.history.find(p => p.sampledCount !== undefined && reaches(p.bestValue))?.sampledCount;
  const random = state.comparison.points.find(p => reaches(p.bestValue))?.sampledCount;
  return { target, active: active ?? null, random: random ?? null,
    saved: active !== undefined && random !== undefined ? random - active : null };
}

/** Keep a reserve for evaluation: at most 10% of a large pool, with a small-pool floor of five. */
export function samplingBudgetLimit(poolSize: number) {
  return poolSize < 2 ? 0 : Math.min(200, poolSize - 1, Math.max(5, Math.floor(poolSize * .1)));
}

export function normalizeSamplingBudget(requested: number, poolSize: number, alreadyObserved = 0) {
  return Math.max(alreadyObserved, Math.min(requested, Math.max(1, samplingBudgetLimit(poolSize))));
}
