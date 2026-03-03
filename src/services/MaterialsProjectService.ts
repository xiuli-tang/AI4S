import axios from "axios";

export interface MPData {
  material_id: string;
  formula_pretty: string;
  elements: string[];
  composition: Record<string, any>;
  band_gap: number;
  formation_energy_per_atom: number;
  structure: any;
}

export class MaterialsProjectService {
  private apiKey: string;
  private baseUrl = "https://api.materialsproject.org";

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async searchLithiumOxides(limit: number = 100): Promise<MPData[]> {
    try {
      // Query for materials containing Li and O
      const response = await axios.get(`${this.baseUrl}/materials/summary/`, {
        headers: {
          "X-API-KEY": this.apiKey,
        },
        params: {
          elements: "Li,O",
          _limit: limit,
          _fields: "material_id,formula_pretty,elements,composition,band_gap,formation_energy_per_atom,structure",
        },
      });

      return response.data.data;
    } catch (error) {
      console.error("Error fetching from Materials Project:", error);
      throw error;
    }
  }
}
