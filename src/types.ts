export interface Material {
  id: string;
  formula: string;
  composition: Record<string, number>;
  features: number[];
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
