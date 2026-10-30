import express, { type NextFunction, type Request, type Response } from "express";
import type { UmlipService } from "./service";
import type { HubStore } from "../hubStore";
import type { StoredHubSource } from "../../src/dataHub";
import { materialRecordKey } from "../../src/materialContext";
import { normalizeComposition } from "../../src/engine/CompositionFeatures";
import { normalizeMaterialStructure } from "../../src/structures/materialStructure";
import { structureFingerprint } from "../../src/structures/fingerprint";
import { asCrystalStructure, compositionOf } from "../../src/umlip/configurations";

export function umlipRouter(service: UmlipService, hub?: HubStore) {
  const router = express.Router();
  router.use((req, res, next) => {
    const origin = req.headers.origin;
    let sameOrigin = true;
    try { if (origin) sameOrigin = new URL(origin).host === req.headers.host; } catch { sameOrigin = false; }
    if (!["127.0.0.1", "localhost", "[::1]"].includes(req.hostname) || !sameOrigin) return res.status(403).json({ error: "uMLIP 计算接口仅供本机同源访问。", service: "umlip" });
    next();
  });
  router.use(express.json({ limit: "2mb" }));
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.get("/capabilities", (_req, res) => res.json(service.capabilities()));
  router.get("/runs", (_req, res) => res.json(service.list()));
  router.post("/runs", (req, res, next) => { try { res.status(202).json(service.start(req.body?.candidates, req.body?.settings)); } catch (e) { next(e); } });
  router.get("/runs/:id", (req, res, next) => { try { res.json(service.get(req.params.id)); } catch (e) { next(e); } });
  router.post("/runs/:id/cancel", (req, res, next) => { try { res.json(service.cancel(req.params.id)); } catch (e) { next(e); } });
  router.get("/runs/:id/candidates/:candidateId/reference", async (req, res, next) => {
    try {
      const run = service.get(req.params.id), c = run.candidates.find(c => c.id === req.params.candidateId);
      if (!c || c.status !== "converged" || !c.result || !run.model || !c.origin || !hub) throw new Error("请选择关联数据库记录的已收敛构型。");
      const [dataset, , id, revision] = JSON.parse(c.origin.recordKey);
      if (!["mp-snapshot", "catalysis-hub", "dual-fidelity"].includes(dataset)) throw new Error("派生构型数据来源无效。");
      const source = hub.record(dataset as StoredHubSource, id, revision);
      if (!source?.row.structure) throw new Error("原始记录结构版本不可用。");
      const key = materialRecordKey({ id, composition: source.row.composition, source: source.row.source, datasetSource: dataset,
        recordRevision: revision, cohort: source.row.cohort, provenance: source.row.provenance });
      const original = normalizeMaterialStructure({ material_id: id, formula_pretty: source.row.formula, structure: source.row.structure, symmetry: source.row.symmetry }, id, source.structureProvenance.retrievedAt, true);
      const originalHash = await structureFingerprint(original);
      const a = normalizeComposition(compositionOf(c.result.structure)), b = normalizeComposition(source.row.composition);
      if (key !== c.origin.recordKey || originalHash !== c.origin.structureHash || Object.keys(a).length !== Object.keys(b).length
        || Object.entries(a).some(([el, value]) => Math.abs(value - (b[el] ?? 0)) > 1e-8)) throw new Error("构型与原始材料版本或组成不匹配。");
      const structure = asCrystalStructure(c.result.structure, c.name, `${run.id}/${c.id}/POSCAR.relaxed`);
      res.json({ structure, binding: { kind: "derived", structureHash: await structureFingerprint(structure), recordKey: key,
        structureRef: { dataset, id, revision }, derived: { runId: run.id, candidateId: c.id, modelSha256: run.model.sha256, parentStructureHash: originalHash } } });
    } catch (e) { next(e); }
  });
  router.get("/runs/:id/candidates/:candidateId/:artifact", (req, res, next) => {
    try {
      const name = req.params.artifact === "poscar" ? "POSCAR.relaxed" : req.params.artifact === "trajectory" ? "trajectory.jsonl" : null;
      if (!name) return res.sendStatus(404);
      res.download(service.artifact(req.params.id, req.params.candidateId, name), name);
    } catch (e) { next(e); }
  });
  router.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(error?.status === 413 ? 413 : error?.status === 409 ? 409 : error?.status === 404 ? 404 : 400)
      .json({ error: error instanceof Error ? error.message.slice(0, 600) : "uMLIP request failed", service: "umlip" });
  });
  return router;
}
