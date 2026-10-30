import type { Material, ALState } from "../types";
import type { CalibrationResult, HubQuery, HubMetadata, StructureRef } from "../dataHub";
import type { ModelConfig } from "../engine/models/config";
import type { AcquisitionStrategy } from "../engine/AcquisitionFunction";
import type { DistillationOptions, DistillationResult, DistillationTarget, PartitionAssignments, Supplements } from "../engine/distillation/types";
import type { ParetoCandidate, ParetoState, ParetoProblem, Weights } from "../engine/pareto/ParetoEngine";
import type { StabilityInput } from "../engine/pareto/ParetoData";
import type { PriceOverrides } from "../engine/pareto/priceBook";
import type { CrystalStructure } from "../structures/types";
import type { ConfigurationInput, UmlipRun } from "../umlip/types";
import type { ExperimentRecord } from "../synthesis/types";

export interface Restore<T> { token: number; value: T }
export interface StructureArtifact {
  id: string; structure: CrystalStructure; structureHash: string; recordKey?: string;
  parentStructureHash?: string; runId?: string; candidateId?: string; modelSha256?: string;
  stage: "database" | "imported" | "initial" | "relaxed"; createdAt: string;
}
export type StructureDraft = Omit<StructureArtifact, "id" | "structureHash" | "createdAt">;
export interface GeometryResult {
  algorithm: "periodic-mo-shell-1"; structureHash: string; recordKey: string; centerSiteIndex: number; cutoff: number;
  neighbors: { siteIndex: number; image: [number, number, number]; distance: number }[];
  meanBondLength: number | null; bondVariance: number | null; octahedralDistortion: number | null;
  volumeChangePerAtom: number | null; referenceStructureHash?: string; note: string;
}
export interface FormulaArchive {
  options: DistillationOptions; target: DistillationTarget; supplements: Supplements; automatic: boolean;
  result: DistillationResult | null; partitions: PartitionAssignments; lastRequested: number;
  draftText?: string;
}
export interface ParetoArchive {
  mode: "demo" | "materials-project"; weights: Weights; budget: number; seed: number; strategy: "ParEGO" | "Random";
  prices: PriceOverrides; externalStability: StabilityInput[]; secondary: string; problem?: ParetoProblem;
  pool: ParetoCandidate[]; state: ParetoState; replay: number | null;
  priceText?: string; stabilityText?: string;
}
export interface AdvisorArchive { turns: any[]; selectedId: string | null; draft: string; preview: boolean; compact: boolean }
export interface UmlipArchive { candidates: ConfigurationInput[]; run: UmlipRun | null; selectedId: string | null; showInitial: boolean; budget: number; batchSize: number; fmax: number; maxSteps: number; files?: Record<string, { poscar?: string; trajectory?: string; error?: string }> }
export interface ResearchModules {
  formula: FormulaArchive | null; pareto: ParetoArchive | null; advisor: AdvisorArchive | null; umlip: UmlipArchive | null;
  experiments: ExperimentRecord[]; structures: StructureArtifact[]; geometry: GeometryResult[];
  calibration: CalibrationResult | null; calibrationEnabled: boolean; stability: StabilityInput[];
}
export const emptyResearchModules = (): ResearchModules => ({ formula: null, pareto: null, advisor: null, umlip: null,
  experiments: [], structures: [], geometry: [], calibration: null, calibrationEnabled: false, stability: [] });
export type SavedCandidate = Omit<Material, "trueProperty" | "objectiveValues" | "energyAboveHull" | "formationEnergyPerAtom" | "pairedDft"> & {
  recordKey: string; ref?: StructureRef; observedValue?: number;
};
export interface ResearchSession {
  schema: "ai4s-research-session-1"; id: string; name: string; savedAt: string;
  query: HubQuery; metadata: HubMetadata | null; candidates: SavedCandidate[];
  state: Omit<ALState, "bestValue" | "history"> & { bestValue: number | null; history: { iteration: number; bestValue: number }[] };
  config: { strategy: AcquisitionStrategy; batchSize: number; totalBudget: number; model: ModelConfig };
  modules: ResearchModules; selectedRecordKey: string | null;
}
