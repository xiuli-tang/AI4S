import axios from "axios";
import { materialRecordKey } from "../materialContext";
import { hydrateHubMaterials } from "../engine/MaterialsEngine";
import { extractCompositionFeatures } from "../engine/CompositionFeatures";
import type { Material, ALState } from "../types";
import { OBJECTIVES, type HubRecord } from "../dataHub";
import { modelConfig } from "../engine/models/config";
import { validateObjectives, normalizeWeights } from "../engine/pareto/ParetoEngine";
import type { ResearchSession, ResearchModules } from "./types";

export function captureSession(input: Omit<ResearchSession, "schema" | "savedAt" | "candidates" | "state"> & { pool: Material[]; state: ALState }): ResearchSession {
  const { pool, state, ...rest } = input;
  const candidates = pool.map(material => {
    const { trueProperty, objectiveValues, energyAboveHull, formationEnergyPerAtom, pairedDft, ...safe } = material;
    const dataset = material.datasetSource === "mp-live" ? "mp-snapshot" : material.datasetSource;
    return { ...safe, recordKey: materialRecordKey(material),
      ...(dataset && material.recordRevision ? { ref: { dataset, id: material.id, revision: material.recordRevision } } : {}),
      ...(material.isSampled ? { observedValue: trueProperty } : {}) };
  });
  const modules = structuredClone(rest.modules);
  if (modules.pareto) modules.pareto.pool = modules.pareto.pool.filter(c => c.observed);
  if (modules.formula) modules.formula.lastRequested = modules.formula.result?.sourceSnapshot.samples.length ?? 0;
  return { ...rest, schema: "ai4s-research-session-1", savedAt: new Date().toISOString(), candidates,
    state: { ...state, bestValue: Number.isFinite(state.bestValue) ? state.bestValue : null,
      history: state.history.map(h => ({ iteration: h.iteration, bestValue: h.bestValue })) }, modules };
}
export function parseSession(value: unknown): ResearchSession {
  const s = value as ResearchSession;
  if (s?.schema !== "ai4s-research-session-1" || typeof s.id !== "string" || !s.id || typeof s.name !== "string"
    || !Array.isArray(s.candidates) || s.candidates.length > 500 || !s.config?.model || !s.modules || !s.state || !s.query
    || typeof s.savedAt !== "string" || !Number.isFinite(Date.parse(s.savedAt)) || !Object.hasOwn(OBJECTIVES, s.query.objective)
    || !["mp-live", "mp-snapshot", "catalysis-hub", "dual-fidelity"].includes(s.query.source)
    || !["Random", "Uncertainty", "EI", "UCB"].includes(s.config.strategy)
    || ![s.config.batchSize, s.config.totalBudget].every(n => Number.isSafeInteger(n) && n > 0)
    || ![s.state.iteration, s.state.sampledCount, s.state.budget].every(n => Number.isSafeInteger(n) && n >= 0)
    || !(s.state.bestValue === null || Number.isFinite(s.state.bestValue)) || !Array.isArray(s.state.history)
    || s.state.history.some(h => !h || !Number.isSafeInteger(h.iteration) || !Number.isFinite(h.bestValue))) throw new Error("研究存档格式无效。");
  modelConfig(s.config.model);
  if ([s.modules.structures, s.modules.experiments, s.modules.geometry, s.modules.stability].some(a => !Array.isArray(a))
    || typeof s.modules.calibrationEnabled !== "boolean") throw new Error("研究存档缺少模块记录。");
  if (s.modules.structures.some(a => !a?.structure || !Array.isArray(a.structure.sites) || !Array.isArray(a.structure.lattice))
    || s.modules.experiments.some(e => !e?.reference?.structure || !e.reference.xrd?.pattern || !e.comparison || !Array.isArray(e.points))
    || s.modules.geometry.some(g => !g?.structureHash || !g.recordKey || !Array.isArray(g.neighbors))) throw new Error("结构或谱图记录格式无效。");
  if (s.modules.formula && (!s.modules.formula.options || !s.modules.formula.supplements || !s.modules.formula.partitions
    || s.modules.formula.result && (!Array.isArray(s.modules.formula.result.sourceSnapshot?.samples) || !Array.isArray(s.modules.formula.result.formulas) || !s.modules.formula.result.metrics))) throw new Error("公式记录格式无效。");
  if (s.modules.advisor && (!Array.isArray(s.modules.advisor.turns) || s.modules.advisor.turns.some(t => !t || typeof t.question !== "string" || t.answer !== undefined && typeof t.answer !== "string"))) throw new Error("顾问记录格式无效。");
  if (s.modules.umlip && (!Array.isArray(s.modules.umlip.candidates) || s.modules.umlip.run && !Array.isArray(s.modules.umlip.run.candidates))) throw new Error("构型运行记录格式无效。");
  if (s.modules.calibration && (!Object.hasOwn(OBJECTIVES, s.modules.calibration.objective) || !Array.isArray(s.modules.calibration.calibrationIds)
    || !Number.isFinite(s.modules.calibration.correction))) throw new Error("校准记录格式无效。");
  if (s.modules.pareto) {
    const p = s.modules.pareto;
    if (!Array.isArray(p.pool) || !Array.isArray(p.state?.history) || !["demo", "materials-project"].includes(p.mode)
      || !Array.isArray(p.weights) || p.weights.length !== 3 || p.problem && (!Array.isArray(p.problem.axes) || p.problem.axes.length !== 3
        || !Array.isArray(p.problem.active) || !["0,2", "0,1,2"].includes(p.problem.active.join()))) throw new Error("多目标记录格式无效。");
    normalizeWeights(p.weights); p.pool.forEach(c => validateObjectives(c.objectives, p.problem));
  }
  if (new Set(s.candidates.map(c => c.recordKey)).size !== s.candidates.length) throw new Error("存档中有重复材料身份。");
  if (s.candidates.some(c => !c.recordKey || c.isSampled && !Number.isFinite(c.observedValue) || !c.isSampled && c.observedValue !== undefined)) throw new Error("存档的观察值与采样状态不一致。");
  if (s.modules.pareto?.pool.some(c => !c.observed)) throw new Error("成果存档不包含未观测多目标标签。");
  return s;
}
export async function restoreCandidatePool(session: ResearchSession, signal?: AbortSignal,
  fetchRecords = async (refs: NonNullable<ResearchSession["candidates"][number]["ref"]>[]) => (await axios.post<{ data: HubRecord[] }>("/api/hub/records", { refs }, { signal })).data.data): Promise<Material[]> {
  const refs = session.candidates.filter(c => c.ref).map(c => c.ref!);
  let records: HubRecord[] = [];
  if (refs.length) records = await fetchRecords(refs);
  const hydrated = records.length && session.metadata ? await hydrateHubMaterials(records, session.metadata) : [];
  return session.candidates.map(saved => {
    const { recordKey, observedValue, ref, ...snapshot } = saved;
    let material: Material;
    if (ref) {
      const source = hydrated.find(m => m.id === ref.id && m.recordRevision === ref.revision);
      if (!source || materialRecordKey(source) !== recordKey) throw new Error(`记录血统不匹配：${saved.id}`);
      if (saved.isSampled && Math.abs(source.trueProperty - observedValue!) > 1e-9) throw new Error(`已观察标签与源版本不一致：${saved.id}`);
      const { isSampled, iteration, predictedMean, predictedStd, acquisitionValue, synthesisFeedback, validationStructure } = snapshot;
      material = { ...source, isSampled, iteration, predictedMean, predictedStd, acquisitionValue, synthesisFeedback, validationStructure };
    } else {
      if (saved.source !== "mock") throw new Error(`缺少可恢复数据引用：${saved.id}`);
      const { descriptors } = extractCompositionFeatures(saved.composition);
      const score = descriptors.statistics.electronegativityPauling.variance! + .05 * descriptors.statistics.chemicalHardnessEv.mean! + .02 * descriptors.statistics.valenceElectrons.mean!;
      material = { ...snapshot, trueProperty: saved.isSampled ? observedValue! : score };
    }
    return material;
  });
}

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("ai4s-research-workspace", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("sessions", { keyPath: "id" });
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
}
export async function saveSession(session: ResearchSession): Promise<void> {
  parseSession(session); const db = await database();
  await new Promise<void>((resolve, reject) => { const tx = db.transaction("sessions", "readwrite"); tx.objectStore("sessions").put(session); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); db.close();
}
export async function sessionHistory(): Promise<ResearchSession[]> {
  const db = await database();
  const result = await new Promise<ResearchSession[]>((resolve, reject) => { const r = db.transaction("sessions").objectStore("sessions").getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
  db.close(); return result.filter(s => { try { parseSession(s); return true; } catch { return false; } }).sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
