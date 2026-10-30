import axios from "axios";
import { Material } from "../types";
import type { MPData } from "../services/MaterialsProjectService";
import { networkIssueCode, type NetworkIssueCode } from "../services/NetworkStatus";
import { extractCompositionFeatures } from "./CompositionFeatures";
import { createSeededRandom } from "./SeededRandom";
import { OBJECTIVES, bestTarget, hubQueryString, type HubMetadata, type HubRecord, type HubQuery, type HubResponse, type ObjectiveDirection } from "../dataHub";
import { normalizeMaterialStructure } from "../structures/materialStructure";
import { structureFingerprint } from "../structures/fingerprint";

function formulaCost(composition: Record<string, number>) {
  const count = Object.values(composition).reduce((sum, amount) => sum + amount, 0);
  if (!Number.isFinite(count)) throw new RangeError("Invalid formula size");
  return 1 + count * 0.2; // Formula-size proxy, not measured DFT hours.
}

/**
 * Real Materials Engine interfacing with Materials Project.
 */
export class MaterialsEngine {
  private pool: Material[] = [];
  private globalMax: number = 0;
  private loadVersion = 0;
  private isRealData = false;
  private activeRequest: AbortController | undefined;
  private loadIssue: NetworkIssueCode | null = null;
  private hubMetadata: HubMetadata | null = null;

  private replacePool(pool: Material[], isRealData: boolean, direction: ObjectiveDirection = "max") {
    this.pool = pool;
    this.globalMax = bestTarget(pool.map(material => material.trueProperty), direction);
    if (pool.length === 0) this.globalMax = 0;
    this.isRealData = isRealData;
  }

  /** Production Data Hub path: real snapshots or an explicit empty/error state, never synthetic fallback. */
  async loadHubData(query: HubQuery): Promise<HubMetadata | null> {
    const version = ++this.loadVersion;
    this.activeRequest?.abort();
    const controller = new AbortController();
    this.activeRequest = controller;
    this.loadIssue = null;
    try {
      const response = await axios.get<HubResponse>(`/api/hub/materials?${hubQueryString(query)}`, { signal: controller.signal, timeout: 65_000 });
      const { data, meta } = response.data ?? {};
      if (!Array.isArray(data) || meta?.objective !== query.objective || meta?.requestedSource !== query.source
        || !["mp-live", "mp-snapshot", "catalysis-hub", "dual-fidelity"].includes(meta?.effectiveSource)) throw new Error("Invalid Data Hub response");
      const pool = await hydrateHubMaterials(data, meta);
      if (new Set(pool.map(m => m.id)).size !== pool.length) throw new Error("Duplicate Data Hub IDs");
      if (version !== this.loadVersion || controller.signal.aborted) return null;
      this.replacePool(pool, true, OBJECTIVES[query.objective].direction);
      this.hubMetadata = meta;
      return meta;
    } catch (error) {
      if (version !== this.loadVersion || controller.signal.aborted || axios.isCancel(error)) return null;
      const reason = error as { code?: string; response?: { data?: { code?: string; error?: string } } };
      this.loadIssue = networkIssueCode(reason.response?.data?.code ?? reason.code);
      this.hubMetadata = null;
      this.replacePool([], true);
      throw new Error(reason.response?.data?.error ?? "Data Hub 数据加载失败，请检查筛选与本地数据库。");
    } finally {
      if (this.activeRequest === controller) this.activeRequest = undefined;
    }
  }

  private materialFromRecord(record: MPData): Material {
    try {
      const { features, descriptors } = extractCompositionFeatures(record.composition);
      if (!Number.isFinite(record.band_gap)) throw new RangeError("Invalid band gap");
      return {
        id: record.material_id,
        formula: record.formula_pretty,
        source: "materials-project",
        composition: record.composition,
        features,
        descriptors,
        targetKind: "band-gap",
        energyAboveHull: typeof record.energy_above_hull === "number" && Number.isFinite(record.energy_above_hull) && record.energy_above_hull >= 0 ? record.energy_above_hull : null,
        formationEnergyPerAtom: Number.isFinite(record.formation_energy_per_atom) ? record.formation_energy_per_atom : null,
        trueProperty: record.band_gap,
        cost: formulaCost(record.composition),
        isSampled: false,
      };
    } catch {
      throw Object.assign(new Error("Invalid material properties"), { code: "BAD_RESPONSE" });
    }
  }

  async loadRealData(limit: number = 150): Promise<boolean> {
    if (!Number.isSafeInteger(limit) || limit < 0) {
      throw new RangeError("Material count must be a non-negative integer");
    }
    const version = ++this.loadVersion;
    this.activeRequest?.abort();
    const controller = new AbortController();
    this.activeRequest = controller;
    this.loadIssue = null;
    try {
      const response = await axios.get(`/api/materials?limit=${limit}`, { signal: controller.signal, timeout: 65_000 });
      const data: MPData[] = response.data.data;
      if (!Array.isArray(data)) throw Object.assign(new Error("Invalid materials response"), { code: "BAD_RESPONSE" });
      
      const pool = data.map(record => this.materialFromRecord(record));

      // Only the latest request owns the dataset, including its global maximum.
      if (version !== this.loadVersion) return this.isRealData;
      this.replacePool(pool, true);
      return true;
    } catch (e) {
      if (version !== this.loadVersion) return this.isRealData;
      if (controller.signal.aborted || axios.isCancel(e)) return this.isRealData;
      const error = e as { code?: string; response?: { data?: { code?: string } } };
      this.loadIssue = networkIssueCode(error.response?.data?.code
        ?? (error.code === "ECONNABORTED" ? "TIMEOUT" : error.code));
      console.warn(`Materials unavailable (${this.loadIssue}); using mock data.`);
      this.replacePool(this.generateMockPool(limit), false);
      return false;
    } finally {
      if (this.activeRequest === controller) this.activeRequest = undefined;
    }
  }

  private generateMockPool(size: number): Material[] {
    const pool: Material[] = [];
    const random = createSeededRandom(0x4d4f434b);
    const elements = ["Li", "La", "Zr", "O", "P", "S", "Ge", "Sn"];
    const examples: Record<string, number>[] = [
      { Li: 2, O: 1 }, { Sr: 1, Ti: 1, O: 3 }, { Ba: 1, Zr: 1, O: 3 },
      { Li: 3, P: 1, O: 4 }, { Li: 7, La: 3, Zr: 2, O: 12 },
    ];
    for (let i = 0; i < size; i++) {
      const composition: Record<string, number> = { ...examples[i] };
      if (i >= examples.length) {
        const selected = [...elements];
        for (let j = selected.length - 1; j > 0; j--) {
          const k = Math.floor(random() * (j + 1));
          [selected[j], selected[k]] = [selected[k], selected[j]];
        }
        const count = 2 + Math.floor(random() * 3);
        selected.slice(0, count).forEach(symbol => { composition[symbol] = 1 + Math.floor(random() * 5); });
      }
      const formula = Object.entries(composition).map(([el, count]) => `${el}${count > 1 ? count : ""}`).join("");
      const { features, descriptors } = extractCompositionFeatures(composition);
      // Synthetic, deterministic demonstration score, not a physical band gap.
      const stats = descriptors.statistics;
      const syntheticScore = (stats.electronegativityPauling.variance ?? 0)
        + 0.05 * (stats.chemicalHardnessEv.mean ?? 0) + 0.02 * (stats.valenceElectrons.mean ?? 0);
      // Keep two records per composition, labelled replicas rather than invented polymorphs.
      for (let p = 0; p < 2; p++) {
        pool.push({
          id: `mock-${i}-${p}`,
          source: "mock",
          formula: p === 1 ? `${formula} (replica)` : formula,
          composition, 
          features: [...features],
          descriptors,
          targetKind: "synthetic-score",
          trueProperty: syntheticScore,
          cost: formulaCost(composition),
          isSampled: false 
        });
      }
    }
    return pool;
  }

  getPool() { return this.pool; }
  getGlobalMax() { return this.globalMax; }
  getLoadIssue() { return this.loadIssue; }
  getHubMetadata() { return this.hubMetadata; }
  cancelLoad() {
    this.loadVersion++;
    this.activeRequest?.abort();
    this.activeRequest = undefined;
  }
}

export async function hydrateHubMaterials(data: HubRecord[], meta: HubMetadata): Promise<Material[]> {
  return Promise.all(data.map(async record => {
        const value = record.values?.[meta.objective];
        if (!Number.isFinite(value) || record.units?.[meta.objective] !== OBJECTIVES[meta.objective].unit
          || !["MP-DFT", "Catalysis-Hub", "GNoME-Extrapolated", "Lab-Experiment"].includes(record.source)
          || !["low-dft", "mid-umlip", "high-exp"].includes(record.fidelity)
          || !record.provenance || !/^[a-f0-9]{64}$/.test(record.revision ?? "")) throw new Error("Invalid Data Hub observation");
        const material: Material = { id: record.id, formula: record.formula, composition: record.composition,
          ...extractCompositionFeatures(record.composition), source: record.source, fidelity: record.fidelity,
          methodMeta: record.methodMeta, provenance: record.provenance, cohort: record.cohort, comparisonBasis: record.comparisonBasis, datasetSource: meta.effectiveSource,
          targetKind: meta.objective, trueProperty: value!, cost: formulaCost(record.composition), isSampled: false,
          recordRevision: record.revision,
          objectiveValues: { ...record.values }, objectiveUnits: { ...record.units },
          energyAboveHull: Number.isFinite(record.values["energy-above-hull"]) ? record.values["energy-above-hull"]! : null,
          formationEnergyPerAtom: Number.isFinite(record.values["formation-energy"]) ? record.values["formation-energy"]! : null,
          pairedDft: record.pairedDft,
          ...(record.structure ? { structureRef: { dataset: meta.effectiveSource === "mp-live" ? "mp-snapshot" as const : meta.effectiveSource,
            id: record.id, revision: record.revision! } } : {}) };
        if (record.structure) material.structureHash = await structureFingerprint(normalizeMaterialStructure({
          material_id: record.id, formula_pretty: record.formula, structure: record.structure, symmetry: record.symmetry,
        }, record.id, meta.fetchedAt ?? new Date().toISOString(), true));
        return material;
        }));
}
