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
   * Simple featurizer for materials based on composition.
   * In a real research scenario, this would use Magpie or GNN.
   */
  private featurize(mpData: MPData): number[] {
    const elements = ["Li", "O", "P", "S", "Ge", "Sn", "La", "Zr"];
    const features = new Array(elements.length + 2).fill(0);
    
    // 1-8: Atomic fractions of key elements
    const totalAtoms = Object.values(mpData.composition).reduce((a: number, b: number) => a + b, 0);
    elements.forEach((el, i) => {
      features[i] = (mpData.composition[el] || 0) / totalAtoms;
    });

    // 9: Band Gap (normalized roughly)
    features[elements.length] = mpData.band_gap / 10;

    // 10: Formation Energy (normalized roughly)
    features[elements.length + 1] = Math.abs(mpData.formation_energy_per_atom) / 5;

    return features;
  }

  async loadRealData(limit: number = 150): Promise<boolean> {
    try {
      const response = await axios.get(`/api/materials?limit=${limit}`);
      const data: MPData[] = response.data.data;
      
      this.pool = data.map(m => ({
        id: m.material_id,
        formula: m.formula_pretty,
        composition: m.composition,
        features: this.featurize(m),
        trueProperty: m.band_gap, 
        isSampled: false,
      }));

      this.globalMax = Math.max(...this.pool.map(m => m.trueProperty));
      return true;
    } catch (e) {
      console.warn("Failed to load real data from API, falling back to mock.");
      this.generateMockPool(limit);
      return false;
    }
  }

  private generateMockPool(size: number) {
    // Fallback logic if API key is missing
    const elements = ["Li", "La", "Zr", "O", "P", "S", "Ge", "Sn"];
    for (let i = 0; i < size; i++) {
      const composition: Record<string, number> = {};
      const numElements = 2 + Math.floor(Math.random() * 3);
      const selected = [...elements].sort(() => 0.5 - Math.random()).slice(0, numElements);
      selected.forEach(el => { composition[el] = Math.floor(Math.random() * 5) + 1; });
      const formula = Object.entries(composition).map(([el, count]) => `${el}${count > 1 ? count : ""}`).join("");
      const features = Array.from({ length: 10 }, () => Math.random());
      const liContent = composition["Li"] || 0;
      const trueProperty = Math.random() * 5 + (liContent * 0.5);
      this.pool.push({ id: `mock-${i}`, formula, composition, features, trueProperty, isSampled: false });
    }
    this.globalMax = Math.max(...this.pool.map(m => m.trueProperty));
  }

  getPool() { return this.pool; }
  getGlobalMax() { return this.globalMax; }
}
