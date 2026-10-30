import { OBJECTIVES, type CalibrationResult } from "../dataHub";
import type { Material } from "../types";
import type { FeaturePoint, TrainingPoint } from "../engine/SurrogateModel";

export function calibrationObservations(result: CalibrationResult, pool: Material[]) {
  if (!Number.isFinite(result.correction) || result.unit !== OBJECTIVES[result.objective].unit) throw new Error("校准目标或单位无效。");
  const keys = new Set(result.calibrationIds);
  if (keys.size !== 10 || [...keys].some(id => !pool.some(m => m.id === id && m.cohort === result.cohort && m.targetKind === result.objective && Number.isFinite(m.pairedDft)))) throw new Error("校准记录不属于当前配对数据集。");
  return pool.map(m => ({ ...m, isSampled: m.isSampled || keys.has(m.id), iteration: keys.has(m.id) ? 0 : m.iteration,
    predictedMean: undefined, predictedStd: undefined, acquisitionValue: undefined }));
}
export function calibratedSurrogate<T extends { train(data: TrainingPoint[]): Promise<void>; predictBatch(data: FeaturePoint[]): any }>(model: T, result: CalibrationResult) {
  return {
    async train(rows: (TrainingPoint & Partial<Material>)[]) {
      if (rows.some(m => !Number.isFinite(m.pairedDft))) throw new Error("校准预测需要同口径配对DFT输入。");
      await model.train(rows.map(m => ({ features: m.features, trueProperty: m.pairedDft! })));
    },
    async predictBatch(rows: FeaturePoint[]) {
      const predictions = await model.predictBatch(rows);
      return predictions.map((p: { mean: number; std: number }) => ({ ...p, mean: p.mean + result.correction }));
    },
  };
}
