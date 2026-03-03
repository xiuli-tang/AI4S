import { Material } from "../types";

export type AcquisitionStrategy = "Random" | "Uncertainty" | "EI" | "UCB";

export class AcquisitionFunction {
  static compute(
    material: Material, 
    strategy: AcquisitionStrategy, 
    bestObserved: number,
    kappa: number = 2.0
  ): number {
    const { mean, std } = { 
      mean: material.predictedMean || 0, 
      std: material.predictedStd || 1 
    };

    switch (strategy) {
      case "Random":
        return Math.random();
      
      case "Uncertainty":
        return std;

      case "UCB":
        // Upper Confidence Bound: mu + kappa * sigma
        return mean + kappa * std;

      case "EI":
        // Expected Improvement (Simplified)
        const z = (mean - bestObserved) / (std || 1e-9);
        // Approximation of EI
        return (mean - bestObserved) * this.phi(z) + std * this.pdf(z);

      default:
        return 0;
    }
  }

  private static phi(x: number): number {
    return 0.5 * (1 + Math.tanh(Math.SQRT1_2 * x));
  }

  private static pdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }
}
