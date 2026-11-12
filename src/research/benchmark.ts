import type { ALState, Material } from "../types";
import { runActiveLearningStep } from "../engine/ActiveLearningLoop";
import { createSeededRandom } from "../engine/SeededRandom";
import { SurrogateModel } from "../engine/SurrogateModel";
import { OBJECTIVES, type ObjectiveId } from "../dataHub";

export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y), p = (a.length - 1) * q, i = Math.floor(p);
  return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (p - i);
}
export async function learningBenchmark(materials: Material[], options: { seeds: number[]; budget: number; objective: ObjectiveId; targetValue?: number; rediscoverIds?: string[] }) {
  const { seeds, budget, objective } = options, direction = OBJECTIVES[objective].direction;
  if (materials.length < 7 || !Number.isSafeInteger(budget) || budget < 6 || budget >= materials.length || budget > 200 || seeds.length < 2 || seeds.some(x => !Number.isSafeInteger(x))
    || new Set(seeds).size !== seeds.length || new Set(materials.map(m => m.id)).size !== materials.length
    || materials.some(m => !Number.isFinite(m.trueProperty) || m.source === "mock" || !m.provenance)) throw new Error("Benchmark requires sourced material labels, 2+ seeds, and a 6–200 budget smaller than the pool.");
  const targetValue = options.targetValue ?? quantile(materials.map(m => m.trueProperty), direction === "max" ? .95 : .05)!;
  if (!Number.isFinite(targetValue)) throw new Error("Target threshold must be finite.");
  const reaches = (v: number) => direction === "max" ? v >= targetValue : v <= targetValue;
  const held = new Set(options.rediscoverIds ?? []), eligible = materials.filter(m => !held.has(m.id));
  if (held.size && (eligible.length < 5 || [...held].some(id => !materials.some(m => m.id === id)))) throw new Error("Rediscovery IDs must exist, with at least five other candidates for initialization.");
  const rows = [];
  for (const seed of seeds) {
    const rng = createSeededRandom(seed), initialOrder = [...eligible];
    for (let i = initialOrder.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [initialOrder[i], initialOrder[j]] = [initialOrder[j], initialOrder[i]]; }
    const first = initialOrder.slice(0, 5), ids = new Set(first.map(m => m.id));
    let pool: Material[] = [...first, ...materials.filter(m => !ids.has(m.id))].map(m => ({ ...m, isSampled: false, iteration: undefined }));
    let state: ALState = { iteration: 0, budget, sampledCount: 0, bestValue: direction === "max" ? -Infinity : Infinity, history: [] };
    const model = new SurrogateModel({ kind: "gpr", seed }), traces = [];
    for (;;) {
      const next = await runActiveLearningStep(pool, state, { totalBudget: budget, batchSize: 2, strategy: "UCB", direction, random: () => 0, comparisonSeed: seed }, model);
      pool = next.pool; state = next.state;
      traces.push({ evaluations: state.sampledCount, ai: state.bestValue, random: state.comparison!.points.at(-1)!.bestValue,
        ...(held.size ? { aiFound: pool.some(m => m.isSampled && held.has(m.id)), randomFound: state.comparison!.points.at(-1)!.sampledIds.some(id => held.has(id)) } : {}) });
      if (next.stopReason) break;
    }
    const hit = (kind: "ai" | "random") => traces.find(p => reaches(p[kind]))?.evaluations ?? null;
    rows.push({ seed, initialIds: state.comparison!.initialIds, budget, aiBest: state.bestValue, randomBest: traces.at(-1)!.random,
      aiHit: hit("ai"), randomHit: hit("random"), ...(held.size ? { rediscovery: { aiHit: traces.find(p => p.aiFound)?.evaluations ?? null, randomHit: traces.find(p => p.randomFound)?.evaluations ?? null } } : {}), traces });
  }
  const summary = (key: "ai" | "random") => {
    const hits = rows.map(r => key === "ai" ? r.aiHit : r.randomHit).filter((n): n is number => n !== null), values = rows.map(r => key === "ai" ? r.aiBest : r.randomBest);
    return { successRate: hits.length / rows.length, successfulSeeds: hits.length, evaluationsMedianAmongSuccesses: quantile(hits, .5),
      bestMedian: quantile(values, .5), bestP10P90: [quantile(values, .1), quantile(values, .9)] };
  };
  const rediscoverySummary = held.size ? Object.fromEntries((["ai", "random"] as const).map(key => {
    const hits = rows.map(r => r.rediscovery?.[key === "ai" ? "aiHit" : "randomHit"]).filter((n): n is number => n != null);
    return [key, { successes: hits.length, successRate: hits.length / rows.length, evaluationsMedianAmongSuccesses: quantile(hits, .5) }];
  })) : null;
  return { schema: "wending-learning-benchmark-1", objective, unit: OBJECTIVES[objective].unit, direction, candidateCount: materials.length, budget, targetValue,
    targetRule: options.targetValue === undefined ? (direction === "max" ? "95th percentile, fixed before runs" : "5th percentile, fixed before runs") : "explicit fixed threshold",
    seedCount: seeds.length, ai: summary("ai"), random: summary("random"), rediscoveryIds: [...held], rediscoverySummary, rows,
    note: "Existing-label retrospective evaluation; shared five initial labels; uniform random without replacement; failures are censored at budget and never converted into invented savings. Rediscovery targets are excluded from initialization." };
}
