import type { Material } from "../../types";
import { extractCompositionFeatures } from "../CompositionFeatures";
import { materialPrice, type PriceOverrides } from "./priceBook";
import type { ObjectiveScales, ParetoCandidate, ParetoProblem, ParetoAxis } from "./ParetoEngine";
import { materialLineage, materialRecordKey } from "../../materialContext";
import { OBJECTIVES, type ObjectiveId } from "../../dataHub";
import { canApplySynthesisFeedback, feasibilityPrior } from "../../synthesis/feedback";

export interface StabilityInput { materialId: string; energyAboveHull: number; source: string; method: string; referenceSet: string; recordKey?: string }
export function parseStabilityInputs(text: string): StabilityInput[] {
  const rows: unknown = JSON.parse(text);
  if (!Array.isArray(rows)) throw new Error("需要稳定性记录数组");
  const seen = new Set<string>();
  return rows.map(row => {
    if (!row || typeof row.materialId !== "string" || !row.materialId || seen.has(row.materialId)
      || typeof row.energyAboveHull !== "number" || !Number.isFinite(row.energyAboveHull) || row.energyAboveHull < 0
      || ![row.source, row.method, row.referenceSet].every(v => typeof v === "string" && v.trim().length > 0)) throw new Error("每条记录需要唯一材料ID、非负Ehull、来源、方法及参考相集合");
    seen.add(row.materialId);
    if (row.recordKey !== undefined && (typeof row.recordKey !== "string" || row.recordKey.length > 4000)) throw new Error("无效记录身份");
    return { materialId: row.materialId, energyAboveHull: row.energyAboveHull, source: row.source, method: row.method, referenceSet: row.referenceSet,
      ...(row.recordKey ? { recordKey: row.recordKey } : {}) };
  });
}
export function demoCandidates(overrides: PriceOverrides = {}): ParetoCandidate[] {
  const symbols = ["Al", "Co", "Ni", "Cu", "Ge", "Sc"];
  const strength = [35, 77, 72, 48, 91, 97];
  const instability = [0.01, 0.035, 0.02, 0.012, 0.15, 0.19];
  const rows: ParetoCandidate[] = [];
  const add = (i: number, j: number, a: number, b: number) => {
    const composition = i === j ? { [symbols[i]]: 1 } : { [symbols[i]]: a, [symbols[j]]: b };
    const x = a / (a + b), mix = i === j ? 0 : 4 * x * (1 - x);
    const performance = i === j ? strength[i] : Math.min(100, x * strength[i] + (1 - x) * strength[j] + 10 * mix * Math.cos((i + j) * 0.7));
    const hull = i === j ? instability[i] : Math.max(0, x * instability[i] + (1 - x) * instability[j] + 0.035 * mix * Math.sin(i + j));
    const price = materialPrice(composition, overrides);
    rows.push({ id: `alloy-${i}-${j}-${a}`, formula: Object.entries(composition).map(([s, n]) => `${s}${n === 1 ? "" : n}`).join(""),
      composition, features: extractCompositionFeatures(composition).features, objectives: [performance, hull, price.usdKg!],
      source: "demo", stabilitySource: "deterministic-demo-v1", priceQuality: price.quality, observed: false });
  };
  for (let i = 0; i < symbols.length; i++) {
    add(i, i, 1, 0);
    for (let j = i + 1; j < symbols.length; j++) for (let a = 1; a <= 6; a++) add(i, j, a, 7 - a);
  }
  return rows;
}
export function isParetoMaterial(material: Material): boolean {
  return (material.targetKind ?? "band-gap") === "band-gap"
    && (material.source === "materials-project" || material.source === "MP-DFT"
      && (material.datasetSource === "mp-live" || material.datasetSource === "mp-snapshot"));
}
export function bindStabilityInputs(rows: StabilityInput[], materials: Material[], allowHub = false): StabilityInput[] {
  return rows.map(row => {
    const material = materials.find(material => material.id === row.materialId && (allowHub || isParetoMaterial(material)));
    if (!material) throw new Error("稳定性记录不属于当前 MP 带隙数据集：" + row.materialId);
    const recordKey = materialRecordKey(material);
    if (row.recordKey && row.recordKey !== recordKey) throw new Error("稳定性记录版本与当前数据不一致");
    return { ...row, recordKey };
  });
}
export function materialCandidates(materials: Material[], overrides: PriceOverrides = {}, stability: StabilityInput[] = []) {
  const external = new Map(stability.map(row => [row.materialId, row]));
  const candidates: ParetoCandidate[] = [];
  let missingStability = 0, missingPrice = 0;
  for (const material of materials) {
    if (!isParetoMaterial(material)) continue;
    const requested = external.get(material.id);
    const imported = requested && (requested.recordKey === materialRecordKey(material)
      || !requested.recordKey && material.source === "materials-project" && !material.recordRevision) ? requested : undefined;
    const hull = imported?.energyAboveHull ?? material.energyAboveHull;
    if (typeof hull !== "number" || !Number.isFinite(hull) || hull < 0) { missingStability++; continue; }
    const price = materialPrice(material.composition, overrides);
    if (price.usdKg === null) { missingPrice++; continue; }
    candidates.push({ id: material.id, formula: material.formula, composition: material.composition, features: material.features,
      objectives: [material.trueProperty, hull, price.usdKg], observed: false, source: "materials-project",
      stabilitySource: imported ? `${imported.source} · ${imported.method} · ${imported.referenceSet}` : "Materials Project energy_above_hull", priceQuality: price.quality,
      lineage: materialLineage(material), objective: { id: "band-gap", unit: "eV", direction: "max" },
      ...(imported ? { stabilityProvenance: { ...imported } } : {}) });
  }
  return { candidates, missingStability, missingPrice };
}
/** Declared scales, not a min/max peek at the hidden candidate target labels. */
export const PARETO_SCALES: Record<"demo" | "materials-project", ObjectiveScales> = {
  demo: { performance: 100, hull: 0.5, price: 6000 },
  "materials-project": { performance: 12, hull: 0.5, price: 6000 },
};

const NORMALIZATION: Record<ObjectiveId, [number, number]> = {
  "band-gap": [0, 12], "formation-energy": [0, 8], "energy-above-hull": [.5, .5],
  "vacancy-energy": [10, 10], "bond-energy": [0, 15], "polarization-resistance": [100, 100], "overpotential": [1000, 1000],
};
export function objectiveAxis(id: ObjectiveId): ParetoAxis {
  const [reference, scale] = NORMALIZATION[id]; return { id, ...OBJECTIVES[id], reference, scale };
}
export function hubParetoCandidates(materials: Material[], primary: ObjectiveId, secondary: ObjectiveId | null,
  overrides: PriceOverrides = {}, stability: StabilityInput[] = [], useSynthesisPrior = true) {
  const axes: ParetoProblem["axes"] = [objectiveAxis(primary), secondary ? objectiveAxis(secondary)
    : { id: "none", zh: "未选第二性质", en: "No secondary property", unit: "1", direction: "min", reference: 1, scale: 1 },
    { id: "price", zh: "采购价", en: "Material price", unit: "USD/kg", direction: "min", reference: 6000, scale: 6000, log: true }];
  const problem: ParetoProblem = { axes, active: secondary ? [0, 1, 2] : [0, 2], useSynthesisPrior };
  const candidates: ParetoCandidate[] = []; let missingStability = 0, missingPrice = 0;
  const imported = new Map(stability.map(row => [row.materialId, row]));
  for (const m of materials) {
    if (!m.datasetSource || !m.provenance || !m.recordRevision) continue;
    const first = m.targetKind === primary ? m.trueProperty : m.objectiveValues?.[primary];
    const firstUnit = m.objectiveUnits?.[primary] ?? (m.targetKind === primary ? OBJECTIVES[primary].unit : undefined);
    if (!Number.isFinite(first) || firstUnit !== axes[0].unit) continue;
    const external = imported.get(m.id);
    const useExternal = secondary === "energy-above-hull" && external?.recordKey === materialRecordKey(m);
    const second = secondary === null ? 0 : useExternal
      ? external.energyAboveHull : m.objectiveValues?.[secondary] ?? (secondary === "energy-above-hull" ? m.energyAboveHull : undefined);
    if (!Number.isFinite(second) || secondary && !useExternal && m.objectiveUnits?.[secondary] !== axes[1].unit) { missingStability++; continue; }
    const price = materialPrice(m.composition, overrides);
    if (price.usdKg === null) { missingPrice++; continue; }
    const feedback = m.synthesisFeedback && canApplySynthesisFeedback(m, m.synthesisFeedback) ? m.synthesisFeedback : undefined;
    candidates.push({ id: m.id, formula: m.formula, composition: m.composition, features: m.features,
      objectives: [first!, second!, price.usdKg], observed: false, source: "data-hub", lineage: materialLineage(m),
      objective: { id: primary, unit: axes[0].unit, direction: axes[0].direction }, stabilitySource: secondary ?? "inactive",
      priceQuality: price.quality, synthesisPrior: feasibilityPrior(feedback, m), synthesisStatus: feedback?.status,
      ...(secondary === "energy-above-hull" && external?.recordKey === materialRecordKey(m) ? { stabilityProvenance: external } : {}) });
  }
  return { candidates, missingStability, missingPrice, problem, scales: { performance: axes[0].scale, hull: axes[1].scale, price: axes[2].scale } };
}
