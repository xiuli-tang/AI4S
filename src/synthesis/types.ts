import type { CrystalStructure } from "../structures/types";
import type { Material } from "../types";
import type { Provenance, ScientificSource, StructureRef } from "../dataHub";

export interface ReferenceBinding {
  kind: "record" | "imported" | "demo" | "derived";
  structureHash: string;
  recordKey?: string;
  structureRef?: StructureRef;
  derived?: { runId: string; candidateId: string; modelSha256: string; parentStructureHash: string };
}

export interface XrdPoint { twoTheta: number; intensity: number }
export interface XrdPeak extends XrdPoint { hkl: string; d: number }
export interface XrdPattern {
  name: string; peaks: XrdPeak[]; profile: XrdPoint[];
  wavelength: string; min: number; max: number; fwhm: number;
}
export interface XrdResult { pattern: XrdPattern; references: XrdPattern[]; engine: string }
export interface PreflightResult {
  grade: "A" | "B" | "C" | "unknown"; label: string; score: number | null;
  energyAboveHull: number | null; formationEnergy: number | null;
  source: "materials-project" | "data-hub" | "demo" | "unavailable" | "external"; temperature: number; atmosphere: string;
  stabilityEvaluation?: { source: string; method: string; referenceSet: string; recordKey: string };
  reference?: StructureRef & { source: ScientificSource; method: string; cohort: string; provenance: Provenance };
  competitors: { formula: string; role: string }[];
  factors: { name: string; score: number }[];
}
export interface ComparisonResult {
  score: number; mainFraction: number; passed: boolean; shift: number; rmse: number;
  peakCoverage: number; phases: { name: string; percent: number; target: boolean }[];
  experimentalPeaks: XrdPoint[]; unmatchedPeaks: XrdPoint[];
  observed: XrdPoint[]; fitted: XrdPoint[]; residual: XrdPoint[];
}
export interface SynthesisFeedback {
  schemaVersion?: 2;
  recordKey?: string;
  reference?: ReferenceBinding;
  materialId: string; formula: string; status: "pass" | "impurity";
  score: number; mainFraction: number; prior: number; sampleId: string;
  filename: string; createdAt: string; demo: boolean;
}
export interface ExperimentRecord {
  id: string; materialId: string; formula: string; filename: string;
  createdAt: string; demo: boolean; temperature: number; atmosphere: string;
  points: XrdPoint[]; comparison: ComparisonResult; feedback?: SynthesisFeedback;
  reference: { structure: CrystalStructure; xrd: XrdResult; preflight: PreflightResult | null; binding?: ReferenceBinding };
}
export interface LabRequest {
  requestId: number; materialId?: string; formula?: string;
  composition?: Record<string, number>; source?: Material["source"];
  recordKey?: string;
  structureRef?: StructureRef;
  demonstration?: boolean;
  structure?: CrystalStructure;
  referenceBinding?: ReferenceBinding;
}
