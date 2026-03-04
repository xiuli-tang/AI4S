import axios from "axios";
import { Material } from "../types";
import { MaterialsProjectService, MPData } from "../services/MaterialsProjectService";

/**
 * Real Materials Engine interfacing with Materials Project.
 */
export class MaterialsEngine {
  private pool: Material[] = [];
  private globalMax: number = 0;
  private mpService: MaterialsProjectService | null = null;

  constructor() {
    const apiKey = process.env.MP_API_KEY || (import.meta as any).env?.VITE_MP_API_KEY;
    if (apiKey && apiKey !== "YOUR_MP_API_KEY") {
      this.mpService = new MaterialsProjectService(apiKey);
    }
  }

  /**
   * Enhanced featurizer including structural descriptors.
   * 1-8: Atomic fractions
   * 9: Electronegativity Difference (Simulated)
   * 10: Lattice Distortion (Simulated)
   * 11: Coordination Number (Simulated)
   */
  private featurize(mpData: MPData): number[] {
    const elements = ["Li", "O", "P", "S", "Ge", "Sn", "La", "Zr"];
    const features = new Array(elements.length + 3).fill(0);
    
    const totalAtoms = Object.values(mpData.composition).reduce((a: number, b: number) => a + b, 0);
    elements.forEach((el, i) => {
      features[i] = (mpData.composition[el] || 0) / totalAtoms;
    });

    // Simulated Structural Descriptors (in real life, these would come from MP or matminer)
    features[elements.length] = Math.random(); // Electronegativity Difference
    features[elements.length + 1] = Math.random(); // Lattice Distortion
    features[elements.length + 2] = Math.floor(Math.random() * 6) + 4; // Coordination Number

    return features;
  }

  async loadRealData(limit: number = 150): Promise<boolean> {
    try {
      const response = await axios.get(`/api/materials?limit=${limit}`);
      const data: MPData[] = response.data.data;
      
      this.pool = data.map(m => {
        const features = this.featurize(m);
        // Cost is proportional to the number of atoms (simulating DFT complexity)
        const totalAtoms = Object.values(m.composition).reduce((a, b) => a + b, 0);
        const cost = 1 + (totalAtoms * 0.2) + (features[features.length - 1] * 0.1); 

        return {
          id: m.material_id,
          formula: m.formula_pretty,
          composition: m.composition,
          features,
          trueProperty: m.band_gap, 
          cost,
          isSampled: false,
        };
      });

      this.globalMax = Math.max(...this.pool.map(m => m.trueProperty));
      return true;
    } catch (e) {
      console.warn("Failed to load real data from API, falling back to mock.");
      this.generateMockPool(limit);
      return false;
    }
  }

  private generateMockPool(size: number) {
    const elements = ["Li", "La", "Zr", "O", "P", "S", "Ge", "Sn"];
    for (let i = 0; i < size; i++) {
      const composition: Record<string, number> = {};
      const numElements = 2 + Math.floor(Math.random() * 3);
      const selected = [...elements].sort(() => 0.5 - Math.random()).slice(0, numElements);
      selected.forEach(el => { composition[el] = Math.floor(Math.random() * 5) + 1; });
      const formula = Object.entries(composition).map(([el, count]) => `${el}${count > 1 ? count : ""}`).join("");
      
      // Generate 2 polymorphs for each composition to demonstrate structural sensitivity
      for (let p = 0; p < 2; p++) {
        const structuralFeatures = [
          Math.random(), // Electronegativity Diff
          Math.random(), // Lattice Distortion
          Math.floor(Math.random() * 6) + 4 // Coordination Number
        ];
        
        const compositionFeatures = elements.map(el => (composition[el] || 0) / 10);
        const features = [...compositionFeatures, ...structuralFeatures];
        
        const liContent = composition["Li"] || 0;
        // Performance depends on both Li content AND structural features
        // e.g. Lattice distortion (features[9]) and Coordination (features[10])
        const trueProperty = (liContent * 0.5) + (features[9] * 2) + (features[10] * 0.1) + Math.random();
        
        const totalAtoms = Object.values(composition).reduce((a, b) => a + b, 0);
        const cost = 1 + (totalAtoms * 0.3) + (p * 0.5); // Polymorph 2 might be more complex

        this.pool.push({ 
          id: `mock-${i}-${p}`, 
          formula: p === 1 ? `${formula} (β)` : formula, 
          composition, 
          features, 
          trueProperty, 
          cost,
          isSampled: false 
        });
      }
    }
    this.globalMax = Math.max(...this.pool.map(m => m.trueProperty));
  }

  getPool() { return this.pool; }
  getGlobalMax() { return this.globalMax; }
}
