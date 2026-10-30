import type { Material } from "../../types";
import { ELEMENT_TABLE_VERSION, FEATURE_SCHEMA_VERSION, extractCompositionFeatures, normalizeComposition, PROPERTY_DEFINITIONS } from "../CompositionFeatures";
import { hashString } from "../SeededRandom";
import { materialLineage, materialRecordKey, targetSpec } from "../../materialContext";
import type { ModelConfig } from "../models/config";
import { DEFAULT_DISTILLATION_OPTIONS, type DistillationOptions, type DistillationSnapshot, type DistillationTarget,
  type PartitionAssignments, type PhysicalFeature, type QueryPoint, type SamplePoint, type Supplements } from "./types";

const COMPOSITION_FEATURES: PhysicalFeature[] = PROPERTY_DEFINITIONS.flatMap(property => {
  const energy = property.key === "chemicalHardnessEv" ? 1 : 0;
  const length = property.key.includes("Radius") ? 1 : 0;
  const symbol = ({ electronegativityPauling: "χ", covalentRadiusAngstrom: "r_cov",
    referenceIonicRadiusAngstrom: "r_ion", valenceElectrons: "V_e", chemicalHardnessEv: "η" })[property.key];
  const unit = energy ? "eV" : length ? "Å" : "1";
  return [
    { id: property.key + ".mean", symbol: "mean(" + symbol + ")", label: property.label + "均值", unit, dimension: [energy, length] as const },
    { id: property.key + ".variance", symbol: "var(" + symbol + ")", label: property.label + "方差", unit: unit === "1" ? "1" : unit + "²", dimension: [energy * 2, length * 2] as const },
    { id: property.key + ".range", symbol: "range(" + symbol + ")", label: property.label + "极差", unit, dimension: [energy, length] as const },
  ];
});
export const PHYSICAL_FEATURES: PhysicalFeature[] = [...COMPOSITION_FEATURES,
  { id: "bond_energy_mo", symbol: "D⁰_M–O", label: "M–O 键解离能（外部数据）", unit: "eV", dimension: [1, 0], extra: true },
  { id: "octahedral_distortion", symbol: "σ_oct", label: "无量纲八面体畸变（外部数据）", unit: "1", dimension: [0, 0], extra: true },
  { id: "volume_change_per_atom", symbol: "ΔV_atom", label: "每原子体积变化（外部参考结构）", unit: "Å³/atom", dimension: [0, 3], extra: true },
  { id: "chi_A", symbol: "χ_A", label: "A 位点电负性（外部位点定义）", unit: "1", dimension: [0, 0], extra: true },
  { id: "chi_B", symbol: "χ_B", label: "B 位点电负性（外部位点定义）", unit: "1", dimension: [0, 0], extra: true },
  { id: "mean_mo_bond_length", symbol: "mean(d_MO)", label: "M–O 平均键长", unit: "Å", dimension: [0, 1], extra: true },
  { id: "mo_bond_variance", symbol: "var(d_MO)", label: "M–O 键长总体方差", unit: "Å²", dimension: [0, 2], extra: true },
];

export function compositionGroup(composition: Record<string, number>): string {
  return Object.entries(normalizeComposition(composition)).sort(([a], [b]) => a.localeCompare(b))
    .map(([symbol, amount]) => symbol + ":" + Number(amount.toPrecision(12))).join("|");
}

export function parseSupplements(text: string, materialIds?: ReadonlySet<string>): Supplements {
  if (text.length > 2_000_000) throw new RangeError("补充数据超过 2 MB");
  const input = JSON.parse(text);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("补充数据须为材料 ID 对象");
  const output: Supplements = Object.create(null);
  for (const [id, fields] of Object.entries(input)) {
    if (["__proto__", "constructor", "prototype"].includes(id) || id.length > 120) throw new TypeError("无效材料 ID");
    if (materialIds && !materialIds.has(id)) throw new TypeError("材料 ID 不在当前数据集中：" + id);
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) throw new TypeError(id + " 的物理量须为对象");
    output[id] = Object.create(null);
    for (const [key, item] of Object.entries(fields)) {
      const feature = PHYSICAL_FEATURES.find(feature => feature.id === key && feature.extra);
      const row = item as Record<string, unknown>;
      if (!feature || !row || typeof row !== "object" || typeof row.value !== "number"
        || !Number.isFinite(row.value) || Math.abs(row.value) > 1e9 || row.unit !== feature.unit
        || typeof row.source !== "string" || !row.source.trim() || typeof row.reference !== "string" || !row.reference.trim()) {
        throw new TypeError(id + "/" + key + " 需要有限 value、正确 unit、source 和 reference");
      }
      if (key === "bond_energy_mo" && row.value <= 0 || key === "octahedral_distortion" && row.value < 0) {
        throw new RangeError("键解离能须为正，归一化畸变须非负");
      }
      const binding = row.binding as any;
      if (binding && (typeof binding.recordKey !== "string" || !/^[a-f0-9]{64}$/.test(binding.structureHash)
        || !Number.isInteger(binding.centerSiteIndex) || !Number.isFinite(binding.cutoff) || typeof binding.algorithm !== "string")) throw new TypeError("无效的几何数据绑定");
      output[id][key] = { value: row.value, unit: feature.unit, source: row.source.slice(0, 300), reference: row.reference.slice(0, 500), ...(binding ? { binding: structuredClone(binding) } : {}) };
    }
  }
  return output;
}

/** This is the sole boundary from the oracle-bearing pool into symbolic search. */
export function buildDistillationSnapshot(pool: Material[], input: {
  runId: number; iteration: number; target: DistillationTarget;
  objective: DistillationSnapshot["objective"]; modelConfig: ModelConfig; supplements?: Supplements;
  partitions?: PartitionAssignments; searchOptions?: DistillationOptions;
  calibration?: DistillationSnapshot["calibration"];
}): DistillationSnapshot {
  if (pool.length > 20_000) throw new RangeError("公式投影最多支持 20000 条候选");
  targetSpec(input.objective);
  const cohorts = new Set(pool.filter(row => row.isSampled && row.cohort).map(row => row.cohort));
  if (cohorts.size > 1) throw new Error("不能混合不同条件组蒸馏公式");
  const samples: SamplePoint[] = [], queries: QueryPoint[] = [];
  const supplements: DistillationSnapshot["supplements"] = [];
  for (const material of pool) {
    if (material.targetKind && material.targetKind !== input.objective) throw new Error("真实性质与合成评分不能混用");
    const descriptors = material.descriptors ?? extractCompositionFeatures(material.composition).descriptors;
    const values = PHYSICAL_FEATURES.map(feature => {
      if (feature.extra) {
        const value = input.supplements?.[material.id]?.[feature.id];
        if (value?.binding && value.binding.recordKey !== materialRecordKey(material)) throw new Error("几何补充量与当前材料版本不一致");
        if (value) supplements.push({ materialId: material.id, feature: feature.id, source: value.source, reference: value.reference,
          ...(value.binding ? { binding: structuredClone(value.binding) } : {}) });
        return value?.value ?? null;
      }
      const [property, statistic] = feature.id.split(".");
      const stats = descriptors.statistics[property as keyof typeof descriptors.statistics];
      return stats.coverage === 1 ? stats[statistic as "mean" | "variance" | "range"] : null;
    });
    const query: QueryPoint = {
      id: material.id, formula: material.formula, group: compositionGroup(material.composition),
      values, features: [...material.features], lineage: materialLineage(material),
    };
    queries.push(query);
    if (material.isSampled) {
      if (!Number.isFinite(material.trueProperty)) throw new Error("已采样性质包含非有限值");
      samples.push({ ...query, label: material.trueProperty, ...(input.calibration && Number.isFinite(material.pairedDft) ? { pairedDft: material.pairedDft } : {}) });
    }
  }
  const data = {
    formatVersion: "ai4s-formula-snapshot-1" as const, featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    elementTableVersion: ELEMENT_TABLE_VERSION, runId: input.runId, iteration: input.iteration,
    target: input.target, objective: input.objective, objectiveMeta: targetSpec(input.objective), modelConfig: { ...input.modelConfig },
    partitions: { ...input.partitions }, searchOptions: { ...DEFAULT_DISTILLATION_OPTIONS, ...input.searchOptions },
    samples, queries, supplements,
    ...(input.calibration ? { calibration: structuredClone(input.calibration) } : {}),
  };
  const lineage = JSON.stringify([data, PHYSICAL_FEATURES]);
  return { id: hashString(lineage).toString(16).padStart(8, "0") + hashString("physics:" + lineage).toString(16).padStart(8, "0"), ...data };
}
