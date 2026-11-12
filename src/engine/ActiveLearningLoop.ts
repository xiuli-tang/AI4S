import { AL_CONFIG, type ALState, type Material } from "../types";
import { AcquisitionFunction, type AcquisitionStrategy } from "./AcquisitionFunction";
import type { FeaturePoint } from "./SurrogateModel";
import type { Prediction } from "./models/regressors";
import { createSeededRandom } from "./SeededRandom";
import { bestTarget, type ObjectiveDirection } from "../dataHub";
import { extendRandomComparison } from "./RandomComparison";

export type StopReason = "empty-pool" | "budget-exhausted" | "candidates-exhausted";

export interface Surrogate {
  train(data: Material[]): void | Promise<void>;
  predict?(material: FeaturePoint): Prediction;
  predictBatch?(materials: FeaturePoint[]): Prediction[] | Promise<Prediction[]>;
}

export interface StepConfig {
  totalBudget: number;
  batchSize: number;
  strategy: AcquisitionStrategy;
  initialSamples?: number;
  random?: () => number;
  signal?: AbortSignal;
  direction?: ObjectiveDirection;
  comparisonSeed?: number;
}

export function getStopReason(pool: Material[], totalBudget: number): StopReason | null {
  if (pool.length === 0) return "empty-pool";
  const sampledCount = pool.filter(material => material.isSampled).length;
  if (sampledCount >= totalBudget) return "budget-exhausted";
  if (sampledCount === pool.length) return "candidates-exhausted";
  return null;
}

/** One immutable, bounded step. React scheduling and cancellation belong to the caller. */
export async function runActiveLearningStep(
  pool: Material[],
  state: ALState,
  config: StepConfig,
  model: Surrogate,
): Promise<{ pool: Material[]; state: ALState; advanced: boolean; stopReason: StopReason | null }> {
  const { totalBudget, batchSize, initialSamples = AL_CONFIG.INITIAL_SAMPLES, random = createSeededRandom(0x414c5345) } = config;
  config.signal?.throwIfAborted();
  if (!Number.isSafeInteger(totalBudget) || totalBudget < 0
    || !Number.isSafeInteger(batchSize) || batchSize < 1
    || !Number.isSafeInteger(initialSamples) || initialSamples < 1) {
    throw new RangeError("Sampling counts must be valid integers");
  }

  // The actual sampled records are authoritative, rather than a separately incremented counter.
  const sampledCount = pool.filter(material => material.isSampled).length;
  const stopReason = getStopReason(pool, totalBudget);
  if (stopReason) {
    return {
      pool,
      state: { ...state, budget: totalBudget, sampledCount },
      advanced: false,
      stopReason,
    };
  }

  const nextPool = pool.map(material => ({ ...material }));
  const initializing = sampledCount === 0;
  if (initializing) {
    const indices = nextPool.map((_, index) => index);
    const count = Math.min(initialSamples, totalBudget, nextPool.length);
    // Partial Fisher-Yates: fixed work even if the RNG always returns the same value.
    for (let i = 0; i < count; i++) {
      const draw = random();
      if (!Number.isFinite(draw) || draw < 0 || draw >= 1) throw new RangeError("RNG must return a value in [0, 1)");
      const j = i + Math.floor(draw * (indices.length - i));
      [indices[i], indices[j]] = [indices[j], indices[i]];
      nextPool[indices[i]].isSampled = true;
      nextPool[indices[i]].iteration = 0;
    }
  }

  const sampled = nextPool.filter(material => material.isSampled);
  await model.train(sampled);
  config.signal?.throwIfAborted();
  const direction = config.direction ?? "max";
  const bestObserved = bestTarget(sampled.map(material => material.trueProperty), direction);
  const scoreRandom = createSeededRandom(0x53434f52 + state.iteration);
  const candidatesToPredict = nextPool.filter(material => !material.isSampled);
  const predictions = model.predictBatch
    ? await model.predictBatch(candidatesToPredict.map(material => ({ features: material.features })))
    : candidatesToPredict.map(material => {
      if (!model.predict) throw new Error("Surrogate requires a prediction method");
      return model.predict({ features: material.features });
    });
  config.signal?.throwIfAborted();
  if (predictions.length !== candidatesToPredict.length) throw new Error("Prediction count does not match candidates");
  for (let i = 0; i < candidatesToPredict.length; i++) {
    const material = candidatesToPredict[i], { mean, std } = predictions[i];
    if (!Number.isFinite(mean) || !Number.isFinite(std) || std < 0) throw new Error("Invalid surrogate prediction");
    material.predictedMean = mean;
    material.predictedStd = std;
    material.acquisitionValue = AcquisitionFunction.compute(material, config.strategy, bestObserved, 2, true, scoreRandom, direction);
  }

  if (!initializing) {
    const count = Math.min(batchSize, totalBudget - sampledCount);
    const candidates = nextPool.filter(material => !material.isSampled)
      .sort((a, b) => (b.acquisitionValue ?? 0) - (a.acquisitionValue ?? 0))
      .slice(0, count);
    for (const material of candidates) {
      material.isSampled = true;
      material.iteration = state.iteration;
    }
  }

  const updated = nextPool.filter(material => material.isSampled);
  const bestValue = bestTarget(updated.map(material => material.trueProperty), direction);
  // Final reports use every acquired label, including the last batch.
  if (!initializing && getStopReason(nextPool, totalBudget)) {
    await model.train(updated);
    config.signal?.throwIfAborted();
    const remaining = nextPool.filter(m => !m.isSampled);
    const finalPredictions = model.predictBatch ? await model.predictBatch(remaining.map(m => ({ features: m.features })))
      : remaining.map(m => model.predict!({ features: m.features }));
    config.signal?.throwIfAborted();
    if (finalPredictions.length !== remaining.length) throw new Error("Prediction count does not match candidates");
    const finalRandom = createSeededRandom(0x53434f52 + state.iteration);
    remaining.forEach((m, i) => {
      const { mean, std } = finalPredictions[i];
      if (!Number.isFinite(mean) || !Number.isFinite(std) || std < 0) throw new Error("Invalid surrogate prediction");
      m.predictedMean = mean; m.predictedStd = std;
      m.acquisitionValue = AcquisitionFunction.compute(m, config.strategy, bestValue, 2, true, finalRandom, direction);
    });
  }
  const globalBest = bestTarget(nextPool.map(material => material.trueProperty), direction);
  const regret = direction === "min" ? bestValue - globalBest : globalBest - bestValue;
  const nextState: ALState = {
    ...state,
    iteration: state.iteration + 1,
    budget: totalBudget,
    sampledCount: updated.length,
    bestValue,
    history: [...state.history, {
      iteration: state.iteration + 1,
      bestValue,
      avgError: 0,
      regret: regret > 1e-6 ? regret : 0,
      sampledCount: updated.length,
      addedIds: updated.filter(m => !pool.find(old => old.id === m.id)?.isSampled).map(m => m.id),
    }],
    comparison: extendRandomComparison(pool, nextPool, state.comparison, config.comparisonSeed ?? 42, direction),
  };
  return { pool: nextPool, state: nextState, advanced: true, stopReason: getStopReason(nextPool, totalBudget) };
}
