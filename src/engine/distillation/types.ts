import type { ModelConfig } from "../models/config";
import type { MaterialLineage, TargetKind, targetSpec } from "../../materialContext";

/** Exponents of energy (eV) and length (Å); electron counts are dimensionless. */
export type Dimension = readonly [number, number];
export interface PhysicalFeature {
  id: string;
  symbol: string;
  label: string;
  unit: string;
  dimension: Dimension;
  extra?: boolean;
}
export type Expression =
  | { op: "variable"; index: number }
  | { op: "one" }
  | { op: "abs" | "sqrt" | "exp"; arg: Expression }
  | { op: "+" | "-" | "*" | "/"; left: Expression; right: Expression; floor?: number };
export interface SupplementValue { value: number; unit: string; source: string; reference: string;
  binding?: { recordKey: string; structureHash: string; algorithm: string; centerSiteIndex: number; cutoff: number; referenceStructureHash?: string } }
export type Supplements = Record<string, Record<string, SupplementValue>>;
export interface QueryPoint {
  id: string;
  formula: string;
  group: string;
  values: (number | null)[];
  features: number[];
  lineage?: MaterialLineage;
}
export interface SamplePoint extends QueryPoint { label: number; pairedDft?: number }
export type DistillationTarget = "observed" | "teacher";
export type PartitionName = "discovery" | "tuning" | "test";
export type PartitionAssignments = Record<string, PartitionName>;
export interface DistillationOptions {
  minSamples: number;
  maxCandidates: number;
  maxDepth: number;
  maxNodes: number;
  l1: number;
  l0: number;
  seed: number;
}
export const DEFAULT_DISTILLATION_OPTIONS: DistillationOptions = {
  minSamples: 20, maxCandidates: 6000, maxDepth: 3, maxNodes: 9,
  l1: 0.03, l0: 0.015, seed: 42,
};
export interface DistillationSnapshot {
  formatVersion: "ai4s-formula-snapshot-1";
  featureSchemaVersion: string;
  elementTableVersion: string;
  partitions: PartitionAssignments;
  searchOptions: DistillationOptions;
  id: string;
  runId: number;
  iteration: number;
  target: DistillationTarget;
  objective: TargetKind;
  objectiveMeta?: ReturnType<typeof targetSpec>;
  modelConfig: ModelConfig;
  calibration?: { correction: number; cohort: string; objective: string; calibrationIds: string[]; unit: string };
  samples: SamplePoint[];
  queries: QueryPoint[];
  supplements: { materialId: string; feature: string; source: string; reference: string; binding?: SupplementValue["binding"] }[];
}
export interface Metrics { count: number; groups: number; invalid: number; mae: number | null; rmse: number | null; r2: number | null }
export interface FormulaTerm {
  expression: Expression;
  text: string;
  latex: string;
  unit: string;
  coefficient: number;
  complexity: number;
}
export interface DistillationResult {
  formatVersion: "ai4s-formula-result-1";
  computationId: string;
  featureDictionary: PhysicalFeature[];
  featureSchemaVersion: string;
  elementTableVersion: string;
  modelConfig: ModelConfig;
  searchOptions: DistillationOptions;
  sourceSnapshot: DistillationSnapshot;
  snapshotId: string;
  runId: number;
  iteration: number;
  target: DistillationTarget;
  objective: DistillationSnapshot["objective"];
  modelKind: ModelConfig["kind"];
  sampledRecords: number;
  uniqueGroups: number;
  split: { discovery: string[]; tuning: string[]; test: string[] };
  splitRecords: { discovery: number; tuning: number; test: number };
  teacherTrainingRecords: number;
  pseudoRecords: number;
  formulas: FormulaTerm[];
  intercept: number;
  axes: { expression: Expression; text: string; unit: string; auxiliary: boolean }[];
  metrics: Metrics;
  teacherMetrics: Metrics;
  fidelity: Metrics | null;
  meanBaseline: Metrics;
  ridgeBaseline: Metrics;
  evaluatedCandidates: number;
  l1Selected: number;
  searchMs: number;
  excludedFeatures: { id: string; reason: string }[];
  alternatives: { complexity: number; tuningRmse: number }[];
  points: { id: string; formula: string; group: string; x: number; y: number; prediction: number; observed: number | null; partition: string }[];
  invalidProjection: number;
  highThreshold: number;
}
