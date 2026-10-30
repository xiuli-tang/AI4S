import type { CompositionDescriptors } from "./engine/CompositionFeatures";
import type { Fidelity, HubSource, ObjectiveId, Provenance, ScientificSource, StructureRef } from "./dataHub";
import type { ReferenceBinding, SynthesisFeedback } from "./synthesis/types";

export interface Material {
  id: string;
  formula: string;
  /** Explicit provenance; an unmarked record is never treated as a real structure. */
  source?: ScientificSource | "materials-project" | "mock";
  fidelity?: Fidelity;
  methodMeta?: string;
  datasetSource?: HubSource;
  recordRevision?: string;
  structureHash?: string;
  provenance?: Provenance;
  structureRef?: StructureRef;
  pairedDft?: number;
  cohort?: string;
  comparisonBasis?: string;
  composition: Record<string, number>;
  features: number[];
  descriptors?: CompositionDescriptors;
  targetKind?: ObjectiveId | "synthetic-score";
  energyAboveHull?: number | null;
  formationEnergyPerAtom?: number | null;
  objectiveValues?: Partial<Record<ObjectiveId, number>>;
  objectiveUnits?: Partial<Record<ObjectiveId, string>>;
  synthesisFeedback?: SynthesisFeedback;
  validationStructure?: ReferenceBinding;
  trueProperty: number; // Only known to the "Oracle"
  cost: number; // Experimental or computational cost
  predictedMean?: number;
  predictedStd?: number;
  acquisitionValue?: number;
  isSampled: boolean;
  iteration?: number;
}

export interface ALState {
  iteration: number;
  budget: number;
  sampledCount: number;
  bestValue: number;
  history: {
    iteration: number;
    bestValue: number;
    avgError: number;
    regret: number;
  }[];
}

export const AL_CONFIG = {
  INITIAL_SAMPLES: 5,
  BATCH_SIZE: 2,
  MAX_ITERATIONS: 20,
  TOTAL_BUDGET: 50,
};
