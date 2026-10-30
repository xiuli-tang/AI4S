import express, { type Request, type Response } from "express";
import OpenAI from "openai";
import { NetworkFailure, httpFailure, networkFailure, type NetworkClient } from "./network";
import { isMaterialId, normalizeMaterialStructure } from "../src/structures/materialStructure";
import { StructureCache } from "../src/structures/StructureCache";
import type { HubStore } from "./hubStore";
import { HubInputError } from "./hubStore";
import { createHubRouter } from "./hubRoutes";
import { mpFilterParams, MP_FIELDS } from "./mpProvider";
import { umlipRouter } from "./umlip/routes";
import type { UmlipService } from "./umlip/service";
import { createSynthesisRouter } from "./synthesis";

interface ApiDependencies {
  network: NetworkClient;
  env?: Record<string, string | undefined>;
  // Dependency injection for local tests, not new user-facing configuration.
  materialsEndpoint?: string;
  chatBaseURL?: string;
  materialsDeadlineMs?: number;
  chatDeadlineMs?: number;
  hub?: HubStore;
  umlip?: UmlipService;
}

function configuredKey(value: string | undefined) {
  const key = value?.trim();
  return key && !/^YOUR_|^你的|[\r\n]/.test(key) ? key : undefined;
}

function requestScope(req: Request, res: Response, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const closed = () => { if (!res.writableEnded) abort(); };
  const timer = setTimeout(() => { timedOut = true; abort(); }, timeoutMs);
  req.once("aborted", abort);
  res.once("close", closed);
  if (req.aborted) abort();
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose() { clearTimeout(timer); req.off("aborted", abort); res.off("close", closed); },
  };
}

function sendFailure(res: Response, error: unknown, service: "materials" | "chat", timedOut = false) {
  if (res.destroyed || res.writableEnded) return;
  const failure = timedOut ? new NetworkFailure("TIMEOUT", 504, true) : networkFailure(error);
  // Never log or forward upstream bodies, URLs, credentials or raw error messages.
  console.error(`[${service}] ${failure.code}${failure.upstreamStatus ? ` upstream=${failure.upstreamStatus}` : ""}`);
  res.status(failure.httpStatus).json({
    error: failure.message, code: failure.code, retryable: failure.retryable, service,
    ...(failure.upstreamStatus ? { upstreamStatus: failure.upstreamStatus } : {}),
  });
}

export function createApiApp({ network, env = process.env, materialsEndpoint = "https://api.materialsproject.org/materials/summary/", chatBaseURL, materialsDeadlineMs = 60_000, chatDeadlineMs = 45_000, hub, umlip }: ApiDependencies) {
  const app = express();
  app.use("/api/hub", createHubRouter({ hub, network, env, materialsEndpoint, deadline: materialsDeadlineMs, requestScope }));
  if (umlip) app.use("/api/umlip", umlipRouter(umlip, hub));
  app.use("/api/synthesis", createSynthesisRouter({ network, env, materialsEndpoint, hub }));
  app.use(express.json({ limit: "100kb" }));
  const structures = new StructureCache<{ record: unknown; fetchedAt: string }>();

  app.get("/api/materials/:materialId/structure", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const materialId = req.params.materialId;
    if (!isMaterialId(materialId)) return sendFailure(res, new NetworkFailure("INVALID_REQUEST", 400), "materials");
    const apiKey = configuredKey(env.MP_API_KEY);
    if (!apiKey) return sendFailure(res, new NetworkFailure("MISSING_API_KEY", 503), "materials");
    const cached = structures.get(materialId);
    if (cached) return res.json({ data: cached.record, meta: { materialId, fetchedAt: cached.fetchedAt, cached: true } });
    const scope = requestScope(req, res, materialsDeadlineMs);
    const notFound = () => {
      if (!res.destroyed && !res.writableEnded) res.status(404).json({ error: "No structure is available for this material.", code: "STRUCTURE_NOT_FOUND", retryable: false, service: "materials" });
    };
    try {
      const response = await network.request<{ data: any[] }>({
        url: materialsEndpoint, signal: scope.signal,
        headers: { accept: "application/json", "X-API-KEY": apiKey, "User-Agent": "AMI-AL-Prototype/2.0" },
        params: { material_ids: materialId, _limit: 1, _fields: "material_id,formula_pretty,structure,symmetry" },
      });
      scope.signal.throwIfAborted();
      if (response.status === 404) return notFound();
      if (response.status < 200 || response.status >= 300) throw httpFailure(response.status);
      const rows = response.data?.data;
      if (!Array.isArray(rows)) throw new NetworkFailure("BAD_RESPONSE");
      if (rows.length === 0) return notFound();
      if (rows.length !== 1 || rows[0]?.material_id !== materialId) throw new NetworkFailure("BAD_RESPONSE");
      if (rows[0].structure == null) return notFound();
      const record = { material_id: rows[0].material_id, formula_pretty: rows[0].formula_pretty, structure: rows[0].structure, symmetry: rows[0].symmetry };
      const fetchedAt = new Date().toISOString();
      try { normalizeMaterialStructure(record, materialId, fetchedAt); }
      catch { throw new NetworkFailure("BAD_RESPONSE"); }
      structures.set(materialId, { record, fetchedAt });
      if (!res.destroyed) res.json({ data: record, meta: { materialId, fetchedAt, cached: false } });
    } catch (error) { sendFailure(res, error, "materials", scope.timedOut()); }
    finally { scope.dispose(); }
  });

  app.get("/api/materials", async (req, res) => {
    const rawLimit = req.query.limit;
    const limit = rawLimit === undefined ? 150 : typeof rawLimit === "string" && /^\d+$/.test(rawLimit) ? Number(rawLimit) : NaN;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) return sendFailure(res, new NetworkFailure("INVALID_REQUEST", 400), "materials");
    let filters: ReturnType<typeof mpFilterParams>;
    try { filters = mpFilterParams(req.query, "Li,O"); }
    catch { return sendFailure(res, new NetworkFailure("INVALID_REQUEST", 400), "materials"); }
    const apiKey = configuredKey(env.MP_API_KEY);
    if (!apiKey) return sendFailure(res, new NetworkFailure("MISSING_API_KEY", 503), "materials");
    const scope = requestScope(req, res, materialsDeadlineMs);
    try {
      const allData = [];
      let skip = 0;
      while (allData.length < limit) {
        scope.signal.throwIfAborted();
        const pageSize = Math.min(1000, limit - allData.length);
        const response = await network.request<{ data: unknown[] }>({
          url: materialsEndpoint, signal: scope.signal,
          headers: { accept: "application/json", "X-API-KEY": apiKey, "User-Agent": "AMI-AL-Prototype/2.0" },
          params: { ...filters, _limit: pageSize, _skip: skip, _fields: MP_FIELDS },
        });
        if (response.status < 200 || response.status >= 300) throw httpFailure(response.status);
        const data = response.data?.data;
        if (!Array.isArray(data)) throw new NetworkFailure("BAD_RESPONSE");
        if (data.length === 0) break;
        const valid = data.every((row: any) => typeof row?.material_id === "string" && Number.isFinite(row.band_gap)
          && row.composition && Object.keys(row.composition).length > 0
          && Object.values(row.composition).every(value => typeof value === "number" && Number.isFinite(value) && value > 0));
        if (!valid) throw new NetworkFailure("BAD_RESPONSE");
        allData.push(...data.slice(0, pageSize));
        skip += data.length;
        if (data.length < pageSize) break;
      }
      if (!res.destroyed) res.json({ data: allData, meta: { total_doc: allData.length } });
    } catch (error) { sendFailure(res, error, "materials", scope.timedOut()); }
    finally { scope.dispose(); }
  });

  app.post("/api/chat", async (req, res) => {
    const apiKey = configuredKey(env.DEEPSEEK_API_KEY);
    if (!apiKey) return sendFailure(res, new NetworkFailure("MISSING_API_KEY", 503), "chat");
    const { messages, model = "deepseek-flash", temperature = 0.7, max_tokens = 2048 } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) return sendFailure(res, new NetworkFailure("INVALID_REQUEST", 400), "chat");
    const scope = requestScope(req, res, chatDeadlineMs);
    try {
      const baseURL = chatBaseURL ?? (env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1");
      const endpoint = new URL(baseURL);
      if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) throw new NetworkFailure("NETWORK_ERROR", 503);
      const openai = new OpenAI({ apiKey, baseURL, fetch: network.fetch, maxRetries: 0, timeout: chatDeadlineMs, logLevel: "off" });
      // Flash defaults to thinking mode upstream. Keep this short, non-streaming
      // advisor responsive; do not send provider-specific options to other hosts.
      const fastFlash = endpoint.hostname === "api.deepseek.com" && model === "deepseek-flash";
      const completion = await openai.chat.completions.create({ model, messages, temperature, max_tokens,
        ...(fastFlash ? { reasoning_effort: "none" as const } : {}), stream: false }, { signal: scope.signal });
      if (!Array.isArray(completion?.choices) || completion.choices.length === 0
        || !completion.choices.every(choice => Number.isInteger(choice?.index) && choice.message?.role === "assistant")) {
        throw new NetworkFailure("BAD_RESPONSE");
      }
      if (!res.destroyed) res.json({
        model: completion.model,
        choices: completion.choices.map(choice => ({ index: choice.index, message: choice.message, finish_reason: choice.finish_reason })),
        usage: completion.usage,
      });
    } catch (error) { sendFailure(res, error, "chat", scope.timedOut()); }
    finally { scope.dispose(); }
  });

  app.use((error: any, _req: Request, res: Response, _next: express.NextFunction) => {
    sendFailure(res, new NetworkFailure("INVALID_REQUEST", error?.status === 413 ? 413 : 400), "chat");
  });
  return app;
}
