/** Shared dataset, observation and objective contracts. Raw targets retain their physical units. */
export const OBJECTIVES = {
  "band-gap": { field: "band_gap", zh: "带隙", en: "Band gap", unit: "eV", direction: "max" },
  "formation-energy": { field: "formation_energy_per_atom", zh: "形成能", en: "Formation energy", unit: "eV/atom", direction: "min" },
  "energy-above-hull": { field: "energy_above_hull", zh: "凸包上能量", en: "Energy above hull", unit: "eV/atom", direction: "min" },
  "vacancy-energy": { field: "oxygen_vacancy_formation_energy", zh: "氧空位形成能", en: "Oxygen vacancy formation energy", unit: "eV", direction: "min" },
  "bond-energy": { field: "metal_oxygen_dissociation_energy", zh: "M–O 键解离能（正值）", en: "M–O dissociation energy (positive)", unit: "eV", direction: "max" },
  "polarization-resistance": { field: "polarization_resistance", zh: "极化电阻", en: "Polarization resistance", unit: "Ω·cm²", direction: "min" },
  "overpotential": { field: "overpotential", zh: "过电位", en: "Overpotential", unit: "mV", direction: "min" },
} as const;
export type ObjectiveId = keyof typeof OBJECTIVES;
export type ObjectiveDirection = "min" | "max";
export type ScientificSource = "MP-DFT" | "Catalysis-Hub" | "GNoME-Extrapolated" | "Lab-Experiment";
export type Fidelity = "low-dft" | "mid-umlip" | "high-exp";
export const HUB_SOURCES = {
  "mp-live": { zh: "实时 MP", en: "Live MP", detail: "在线查询 · 成功结果写入本地快照" },
  "mp-snapshot": { zh: "离线 MP", en: "Offline MP", detail: "真实结构与 DFT 属性 · SQLite" },
  "catalysis-hub": { zh: "催化 / 电极", en: "Catalysis / electrode", detail: "有来源的计算或实验记录" },
  "dual-fidelity": { zh: "DFT + 实验", en: "DFT + experiment", detail: "配对对齐 · 10 组偏差校准" },
} as const;
export type HubSource = keyof typeof HUB_SOURCES;
export type StoredHubSource = Exclude<HubSource, "mp-live">;
export interface Provenance {
  reference: string;
  url: string;
  datasetVersion: string;
  retrievedAt: string;
  license: string;
  taskIds?: string[];
}
export interface HubRecord {
  id: string;
  formula: string;
  composition: Record<string, number>;
  values: Partial<Record<ObjectiveId, number>>;
  units: Partial<Record<ObjectiveId, string>>;
  source: ScientificSource;
  fidelity: Fidelity;
  methodMeta: string;
  /** Same conditions/basis within a benchmark cohort; never silently pool unlike measurements. */
  cohort: string;
  provenance: Provenance;
  structure?: unknown;
  structureProvenance?: Provenance;
  comparisonBasis?: string;
  symmetry?: unknown;
  pairedDft?: number;
  revision?: string;
  /** Lightweight list projection; full geometry is fetched by exact revision. */
  hasStructure?: boolean;
  structureHash?: string;
}
export interface FidelityPair {
  id: string;
  formula: string;
  composition: Record<string, number>;
  objective: ObjectiveId;
  unit: string;
  cohort: string;
  comparisonBasis: string;
  dft: { value: number; methodMeta: string; provenance: Provenance };
  experiment: { value: number; methodMeta: string; provenance: Provenance };
  structure?: unknown;
  structureProvenance?: Provenance;
}
export interface HubQuery {
  source: HubSource;
  objective: ObjectiveId;
  elements: string;
  excludeElements: string;
  match: "contains" | "exact";
  cohort: string;
  limit: number;
}
export const MAX_HUB_CANDIDATES = 5000;
export const DEFAULT_HUB_QUERY: HubQuery = { source: "mp-snapshot", objective: "band-gap", elements: "", excludeElements: "", match: "contains", cohort: "", limit: 2000 };
export interface HubMetadata {
  requestedSource: HubSource;
  effectiveSource: HubSource;
  objective: ObjectiveId;
  total: number;
  /** Full eligible match count; total remains the number loaded into this candidate pool. */
  matchedTotal?: number;
  sourceVersion?: string;
  snapshotSha256?: string;
  sourceURL?: string;
  datasetVersion: string;
  fetchedAt: string | null;
  fallbackReason?: string;
  excludedMissingTarget: number;
  query: HubQuery;
}
export interface HubResponse { data: HubRecord[]; meta: HubMetadata; }
export interface HubCatalog {
  sources: { id: StoredHubSource; count: number; updatedAt: string | null; cohorts: string[];
    provider?: "mp-summary-mirror"; datasetVersion?: string; rawCount?: number; snapshotSha256?: string; sourceURL?: string }[];
}
export interface StructureRef { dataset: StoredHubSource; id: string; revision: string; }
export interface CalibrationResult {
  objective: ObjectiveId; unit: string; cohort: string;
  model: "constant-bias"; correction: number;
  calibrationIds: string[]; validationIds: string[];
  calibrationGroups: number; validationGroups: number;
  validation: { baselineMAE: number; correctedMAE: number } | null;
  note: string;
}
export function hubQueryString(query: HubQuery) {
  return new URLSearchParams({ source: query.source, objective: query.objective, elements: query.elements,
    exclude_elements: query.excludeElements, match: query.match, cohort: query.cohort, limit: String(query.limit) }).toString();
}
export function bestTarget(values: number[], direction: ObjectiveDirection = "max") {
  return direction === "min" ? Math.min(...values) : Math.max(...values);
}
export function sourceLabel(source: string | undefined, lang: "zh" | "en" = "zh") {
  if (source && Object.hasOwn(HUB_SOURCES, source)) return HUB_SOURCES[source as HubSource][lang];
  return source === "materials-project" ? "Materials Project" : source === "mock" ? "Mock" : source ?? "—";
}
