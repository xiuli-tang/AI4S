import express, { type Request, type Response } from "express";
import { OBJECTIVES, type HubMetadata, type StoredHubSource } from "../src/dataHub";
import { calibratePairs } from "../src/engine/DualFidelityCalibration";
import { HubInputError, HubStore, parseHubQuery } from "./hubStore";
import { fetchMPRecords } from "./mpProvider";
import { NetworkFailure, networkFailure, type NetworkClient } from "./network";

type Scope = { signal: AbortSignal; timedOut(): boolean; dispose(): void };
interface Dependencies {
  hub?: HubStore; network: NetworkClient; env: Record<string, string | undefined>; materialsEndpoint: string; deadline: number;
  requestScope(req: Request, res: Response, timeout: number): Scope;
}
const datasets: StoredHubSource[] = ["mp-snapshot", "catalysis-hub", "dual-fidelity"];
function storedSource(value: unknown): StoredHubSource {
  if (typeof value !== "string" || !datasets.includes(value as StoredHubSource)) throw new HubInputError("无效的本地数据源。");
  return value as StoredHubSource;
}
function failure(res: Response, error: unknown) {
  if (res.destroyed || res.writableEnded) return;
  if (error instanceof HubInputError || error instanceof RangeError) return res.status(400).json({ error: error.message, code: "INVALID_REQUEST", service: "hub", retryable: false });
  const safe = networkFailure(error);
  res.status(safe.httpStatus).json({ error: safe.message, code: safe.code, retryable: safe.retryable, service: "materials" });
}
export function createHubRouter({ hub, network, env, materialsEndpoint, deadline, requestScope }: Dependencies) {
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); if (!hub) return res.status(503).json({ error: "Data Hub storage is unavailable.", code: "LOCAL_STORAGE_UNAVAILABLE" }); next(); });
  router.use(express.json({ limit: "8mb" }));
  router.use((req, res, next) => {
    if (req.method === "POST" && req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-origin writes are not allowed.", code: "ACCESS_DENIED" }); }
      catch { return res.status(400).json({ error: "Invalid origin.", code: "INVALID_REQUEST" }); }
    }
    next();
  });
  router.get("/catalog", (_req, res) => { try { res.json(hub!.catalog()); } catch (e) { failure(res, e); } });
  router.post("/records", (req, res) => {
    try {
      const refs = req.body?.refs;
      if (!Array.isArray(refs) || refs.length > 500) throw new HubInputError("恢复引用限500条。");
      const data = refs.map(ref => {
        const dataset = storedSource(ref?.dataset);
        if (typeof ref?.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(ref.id) || !/^[a-f0-9]{64}$/.test(ref.revision)) throw new HubInputError("记录引用无效。");
        const record = hub!.record(dataset, ref.id, ref.revision);
        if (!record) throw new HubInputError(`本地缺少记录版本：${ref.id}；可先展示存档成果，或导入对应源数据后继续研究。`);
        return { ...record.row, revision: record.revision };
      });
      res.json({ data });
    } catch (e) { failure(res, e); }
  });
  router.get("/materials", async (req, res) => {
    let scope: Scope | undefined;
    try {
      const query = parseHubQuery(req.query);
      let effectiveSource: StoredHubSource = query.source === "mp-live" ? "mp-snapshot" : query.source;
      let fallbackReason: string | undefined;
      if (query.source === "mp-live") {
        scope = requestScope(req, res, deadline);
        try {
          const records = await fetchMPRecords(network, env, materialsEndpoint, query, scope.signal);
          scope.signal.throwIfAborted();
          if (records.length) hub!.import("mp-snapshot", records, true);
          // Select exactly the freshly fetched IDs, not stale unrelated cached records.
          const latestIds = new Set(records.map(r => r.id));
          const result = hub!.select("mp-snapshot", query, latestIds);
          const fresh = result.data.map((row, i) => ({ ...row, revision: result.revisions[i] })).filter(row => latestIds.has(row.id)).slice(0, query.limit);
          const meta: HubMetadata = { requestedSource: query.source, effectiveSource: "mp-live", objective: query.objective, total: fresh.length,
            datasetVersion: result.datasetVersion, fetchedAt: result.fetchedAt, excludedMissingTarget: records.length - fresh.length, query };
          if (!res.destroyed) res.json({ data: fresh, meta });
          return;
        } catch (error) {
          if (scope.signal.aborted && !scope.timedOut()) return;
          fallbackReason = scope.timedOut() ? "TIMEOUT" : networkFailure(error).code;
        }
      }
      const result = hub!.select(effectiveSource, query);
      const meta: HubMetadata = { requestedSource: query.source, effectiveSource, objective: query.objective, total: result.data.length,
        datasetVersion: result.datasetVersion, fetchedAt: result.fetchedAt, excludedMissingTarget: result.excludedMissingTarget, fallbackReason, query };
      if (!res.destroyed) res.json({ data: result.data.map((row, i) => ({ ...row, revision: result.revisions[i] })), meta });
    } catch (e) { failure(res, e); }
    finally { scope?.dispose(); }
  });
  router.get("/structure", (req, res) => {
    try {
      const source = storedSource(req.query.dataset), id = req.query.id, revision = req.query.revision;
      if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(id) || typeof revision !== "string" || !/^[a-f0-9]{64}$/.test(revision)) throw new HubInputError("结构引用无效。");
      const record = hub!.structure(source, id, revision);
      if (!record) return res.status(404).json({ error: "此数据版本没有结构。", code: "STRUCTURE_NOT_FOUND", service: "materials" });
      res.json({ data: { material_id: id, formula_pretty: record.row.formula, structure: record.row.structure, symmetry: record.row.symmetry },
        meta: { materialId: id, fetchedAt: record.structureProvenance.retrievedAt, cached: true, dataset: source, revision, provenance: record.structureProvenance } });
    } catch (e) { failure(res, e); }
  });
  router.post("/import", (req, res) => {
    try {
      const dataset = storedSource(req.body?.dataset);
      if (dataset === "mp-snapshot") throw new HubInputError("MP快照由在线同步写入；请勿将手工数据标为官方MP记录。");
      const count = hub!.import(dataset, dataset === "dual-fidelity" ? req.body?.pairs : req.body?.records);
      res.json({ imported: count, catalog: hub!.catalog(), note: "来源字段通过格式校验；观测真实性、方法可比性仍需人工复核。" });
    } catch (e) { failure(res, e); }
  });
  router.get("/template", (req, res) => {
    try {
      const dataset = storedSource(req.query.dataset);
      if (dataset === "mp-snapshot") throw new HubInputError("MP快照请使用在线同步。");
      const provenance = { reference: "填写真实文献/实验记录", url: "https://doi.org/REPLACE_WITH_REAL_DOI", datasetVersion: "填写原始版本", retrievedAt: new Date().toISOString(), license: "填写实际许可/内部使用约定" };
      const base = { id: "your-observation-id", formula: "PrBaCo2O5.5", composition: { Pr: 1, Ba: 1, Co: 2, O: 5.5 }, cohort: "填写同一测量条件/参考能口径" };
      res.json(dataset === "dual-fidelity" ? { dataset, pairs: [{ ...base, objective: "band-gap", unit: "eV", comparisonBasis: "填写同一结构/测量目标可比性的依据",
        dft: { value: null, methodMeta: "填写泛函/U/自旋/收敛条件", provenance }, experiment: { value: null, methodMeta: "填写实验方法和条件", provenance } }] }
        : { dataset, records: [{ ...base, values: { "vacancy-energy": null }, units: { "vacancy-energy": "eV" }, source: "Catalysis-Hub", fidelity: "low-dft", methodMeta: "填写参考能、缺陷模型及计算方法", provenance }] });
    } catch (e) { failure(res, e); }
  });
  router.post("/calibrate", (req, res) => {
    try {
      const objective = req.body?.objective, cohort = req.body?.cohort;
      if (typeof objective !== "string" || !Object.hasOwn(OBJECTIVES, objective) || typeof cohort !== "string" || !cohort) throw new HubInputError("请选择目标和单一配对cohort。");
      const ids = req.body?.ids;
      if (ids !== undefined && (!Array.isArray(ids) || ids.length > 500 || ids.some(id => typeof id !== "string"))) throw new HubInputError("校准ID列表无效。");
      res.json(calibratePairs(hub!.pairs().filter(p => !ids || ids.includes(p.id)), objective as keyof typeof OBJECTIVES, cohort));
    } catch (e) { failure(res, e); }
  });
  router.use((error: any, _req: Request, res: Response, _next: express.NextFunction) => {
    if (error?.status === 413) return res.status(413).json({ error: "导入内容超过8MB。", code: "INVALID_REQUEST", service: "hub" });
    failure(res, new HubInputError("请求JSON格式无效。"));
  });
  return router;
}
