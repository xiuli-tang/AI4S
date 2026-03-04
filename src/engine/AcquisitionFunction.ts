import { Material } from "../types";

export type AcquisitionStrategy = "Random" | "Uncertainty" | "EI" | "UCB";

export class AcquisitionFunction {
  static compute(
    material: Material, 
    strategy: AcquisitionStrategy, 
    bestObserved: number,
    kappa: number = 2.0,
    isCostAware: boolean = true
  ): number {
    const { mean, std } = { 
      mean: material.predictedMean || 0, 
      std: material.predictedStd || 1e-6 
    };

    let value = 0;
    switch (strategy) {
      case "Random":
        value = Math.random();
        break;
      
      case "Uncertainty":
        value = std;
        break;

      case "UCB":
        value = mean + kappa * std;
        break;

      case "EI":
        const z = (mean - bestObserved) / (std || 1e-9);
        value = (mean - bestObserved) * this.phi(z) + std * this.pdf(z);
        break;

      default:
        value = 0;
    }

    // Cost-aware BO: Acquisition per unit cost
    if (isCostAware && material.cost > 0) {
      return value / material.cost;
    }
    return value;
  }

  private static phi(x: number): number {
    return 0.5 * (1 + Math.tanh(Math.SQRT1_2 * x));
  }

  private static pdf(x: number): number {
    return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
  }
}
