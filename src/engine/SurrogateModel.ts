import { Material } from "../types";

/**
 * Simple Surrogate Model using Random Forest-like uncertainty (Ensemble of Linear Regressions for demo)
 * In a real system, this would be GPR or a GNN with MC Dropout.
 */
export class SurrogateModel {
  private weights: number[][] = [];
  private bias: number[] = [];
  private ensembleSize = 5;

  async train(sampledData: Material[]) {
    if (sampledData.length === 0) return;

    const X = sampledData.map(m => m.features);
    const y = sampledData.map(m => m.trueProperty);

    this.weights = [];
    this.bias = [];

    // Train ensemble
    for (let i = 0; i < this.ensembleSize; i++) {
      // Bootstrap sampling
      const indices = Array.from({ length: X.length }, () => Math.floor(Math.random() * X.length));
      const subX = indices.map(idx => X[idx]);
      const subY = indices.map(idx => y[idx]);

      // Simple SGD-like fit for demo
      const featureDim = X[0].length;
      let w = new Array(featureDim).fill(0);
      let b = 0;
      const lr = 0.01;
      
      for (let epoch = 0; epoch < 100; epoch++) {
        for (let j = 0; j < subX.length; j++) {
          const pred = subX[j].reduce((acc, val, idx) => acc + val * w[idx], 0) + b;
          const err = pred - subY[j];
          w = w.map((v, idx) => v - lr * err * subX[j][idx]);
          b -= lr * err;
        }
      }
      this.weights.push(w);
      this.bias.push(b);
    }
  }

  predict(material: Material): { mean: number; std: number } {
    if (this.weights.length === 0) return { mean: 0, std: 1 };

    const preds = this.weights.map((w, i) => {
      return material.features.reduce((acc, val, idx) => acc + val * w[idx], 0) + this.bias[i];
    });

    const mean = preds.reduce((a, b) => a + b, 0) / preds.length;
    const variance = preds.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / preds.length;
    
    return {
      mean,
      std: Math.sqrt(variance) + 0.1, // Add small floor for uncertainty
    };
  }
}
