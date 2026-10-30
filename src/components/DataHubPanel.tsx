import { useEffect, useState } from "react";
import axios from "axios";
import { Database, Globe2, FlaskConical, GitCompareArrows, RefreshCw } from "lucide-react";
import { HUB_SOURCES, OBJECTIVES, type CalibrationResult, type HubCatalog, type HubMetadata, type HubQuery, type HubSource, type ObjectiveId } from "../dataHub";
import { networkMessage, networkIssueCode } from "../services/NetworkStatus";
import MethodNote from "./MethodNote";

interface Props {
  query: HubQuery; metadata: HubMetadata | null; count: number; loading: boolean; lang: "zh" | "en";
  onChange(query: HubQuery): void; onLoad(query: HubQuery): void;
  recordIds?: string[]; onCalibration?(result: CalibrationResult, enabled: boolean): void; providedCalibration?: CalibrationResult | null; calibrationEnabled?: boolean;
}
export default function DataHubPanel({ query, metadata, count, loading, lang, onChange, onLoad, recordIds, onCalibration, providedCalibration, calibrationEnabled }: Props) {
  const zh = lang === "zh";
  const t = (a: string, b: string) => zh ? a : b;
  const [catalog, setCatalog] = useState<HubCatalog>({ sources: [] });
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [localCalibration, setCalibration] = useState<CalibrationResult | null>(null);
  const calibration = providedCalibration === undefined ? localCalibration : providedCalibration;
  useEffect(() => {
    const controller = new AbortController();
    axios.get<HubCatalog>("/api/hub/catalog", { signal: controller.signal }).then(r => setCatalog(r.data)).catch(() => {});
    return () => controller.abort();
  }, [metadata?.datasetVersion]);
  useEffect(() => { setCalibration(null); setMessage(null); setText(""); }, [query.source, query.objective, query.cohort]);
  useEffect(() => { setCalibration(null); }, [metadata?.datasetVersion, catalog.sources.find(s => s.id === query.source)?.updatedAt]);
  const local = catalog.sources.find(s => s.id === (query.source === "mp-live" ? "mp-snapshot" : query.source));
  const cohort = query.cohort || (local?.cohorts.length === 1 ? local.cohorts[0] : "");
  const locked = loading || busy;
  const input = "w-full rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-800 disabled:opacity-50";
  const choose = (source: HubSource) => {
    const objective = source.startsWith("mp-") && !["band-gap", "formation-energy", "energy-above-hull"].includes(query.objective) ? "band-gap" : query.objective;
    onLoad({ ...query, source, objective, cohort: "", elements: source === "mp-live" && !query.elements ? "Li,O" : query.elements });
  };
  const showError = (error: any) => setMessage(error?.response?.data?.error ?? t("请求未完成，请重试。", "Request failed. Retry."));
  async function template() {
    setBusy(true); setMessage(null);
    try { setText(JSON.stringify((await axios.get("/api/hub/template", { params: { dataset: query.source } })).data, null, 2)); }
    catch (e) { showError(e); } finally { setBusy(false); }
  }
  async function importData() {
    setBusy(true); setMessage(null);
    try {
      const payload = JSON.parse(text);
      if (payload.dataset !== query.source) throw new Error(t("模板的数据源与当前选择不一致。", "Template source does not match selection."));
      const result = await axios.post("/api/hub/import", payload);
      setCatalog(result.data.catalog); setMessage(`${t("已导入", "Imported")} ${result.data.imported} ${t("条；来源与可比性需人工复核。", "records; review provenance and comparability.")}`);
      onLoad(query);
    } catch (e) { setMessage((e as any)?.response?.data?.error ?? (e as Error).message); }
    finally { setBusy(false); }
  }
  async function calibrate() {
    setBusy(true); setMessage(null);
    try { const result = (await axios.post("/api/hub/calibrate", { objective: query.objective, cohort, ids: recordIds })).data; setCalibration(result); onCalibration?.(result, false); }
    catch (e) { showError(e); } finally { setBusy(false); }
  }
  const icons = { "mp-live": Globe2, "mp-snapshot": Database, "catalysis-hub": FlaskConical, "dual-fidelity": GitCompareArrows };
  return <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm" aria-labelledby="data-hub-heading">
    <div className="bg-[#153d46] px-5 py-5 text-white"><p className="text-[9px] tracking-[.25em] text-teal-200">MATERIALS · DATA HUB</p><h2 id="data-hub-heading" className="mt-1 text-lg font-semibold">{t("多源多保真数据中枢", "Multi-source data hub")}</h2><p className="mt-2 text-xs text-teal-100">{t("真实数据 · 可追溯来源 · 离线可用", "Real records · provenance · offline access")}</p></div>
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-2" aria-label={t("数据源切换器", "Dataset selector")}>
        {(Object.keys(HUB_SOURCES) as HubSource[]).map(id => { const Icon = icons[id]; return <button type="button" key={id} aria-pressed={query.source === id} disabled={locked} onClick={() => choose(id)} className={`rounded-xl border px-2 py-3 text-left text-xs font-semibold transition-colors ${query.source === id ? "border-teal-700 bg-teal-50 text-teal-900" : "border-slate-200 text-slate-600 hover:bg-slate-50"} disabled:opacity-40`}><Icon size={16} className="mb-2" />{HUB_SOURCES[id][lang]}</button>; })}
      </div>
      <label className="block text-xs font-semibold text-slate-600" htmlFor="hub-objective">{t("优化目标", "Objective")}</label>
      <select id="hub-objective" className={input} value={query.objective} disabled={locked} onChange={e => onLoad({ ...query, objective: e.target.value as ObjectiveId })}>
        {(Object.keys(OBJECTIVES) as ObjectiveId[]).filter(id => !query.source.startsWith("mp-") || ["band-gap", "formation-energy", "energy-above-hull"].includes(id)).map(id => <option key={id} value={id}>{OBJECTIVES[id][lang]} · {OBJECTIVES[id].unit} · {OBJECTIVES[id].direction === "min" ? "↓ min" : "↑ max"}</option>)}
      </select>
      <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">{t("包含元素", "Include elements")}<input id="hub-elements" aria-label={t("包含元素", "Include elements")} className={`${input} mt-1`} placeholder="Pr,Ba,Co,O" value={query.elements} disabled={locked} onChange={e => onChange({ ...query, elements: e.target.value })} /></label><label className="text-[10px] text-slate-500">{t("排除元素", "Exclude elements")}<input aria-label={t("排除元素", "Exclude elements")} className={`${input} mt-1`} placeholder="Au,Pt,Ir" value={query.excludeElements} disabled={locked} onChange={e => onChange({ ...query, excludeElements: e.target.value })} /></label></div>
      <select aria-label={t("化学体系匹配", "Chemical system matching")} className={input} value={query.match} disabled={locked} onChange={e => onChange({ ...query, match: e.target.value as HubQuery["match"] })}><option value="contains">{t("包含这些元素（允许其它元素）", "Contains these elements")}</option><option value="exact">{t("精确化学体系（只含所列元素）", "Exact chemical system")}</option></select>
      <div className="grid grid-cols-2 gap-2"><label className="text-[10px] text-slate-500">{t("读取上限", "Record limit")}<input aria-label={t("读取上限", "Record limit")} className={`${input} mt-1`} type="number" min={1} max={500} value={query.limit} disabled={locked} onChange={e => onChange({ ...query, limit: Number(e.target.value) })} /></label><label className="text-[10px] text-slate-500">{t("条件 / 配对组", "Condition / cohort")}<select aria-label={t("条件或配对组", "Condition or cohort")} className={`${input} mt-1`} value={query.cohort} disabled={locked} onChange={e => onLoad({ ...query, cohort: e.target.value })}><option value="">{t("选择口径", "Select cohort")}</option>{local?.cohorts.map(c => <option key={c}>{c}</option>)}</select></label></div>
      <button type="button" className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-800 py-2.5 text-xs font-semibold text-white disabled:opacity-40" onClick={() => onLoad(query)} disabled={locked}><RefreshCw size={13} />{loading ? t("加载中…", "Loading…") : t("应用筛选 / 同步", "Apply filters / sync")}</button>
      <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600" role="status"><p className="font-semibold text-slate-800">{metadata ? HUB_SOURCES[metadata.effectiveSource][lang] : HUB_SOURCES[query.source][lang]} · {count} {t("条可用", "eligible records")}</p><p className="mt-1">{t("本地库", "Local collection")} {local?.count ?? 0} · {OBJECTIVES[query.objective].unit}</p>{metadata?.fetchedAt && <p className="mt-1 text-[10px]">{t("源数据获取", "Data retrieved")} {new Date(metadata.fetchedAt).toLocaleString()}</p>}{metadata?.datasetVersion && <p className="mt-1 font-mono text-[9px]">{metadata.datasetVersion}</p>}{metadata?.fallbackReason && <p className="mt-2 text-amber-800">{networkMessage(networkIssueCode(metadata.fallbackReason), lang)} {t("已改用真实本地快照。", "Using a real local snapshot.")}</p>}{!loading && count === 0 && <p className="mt-2 text-amber-800">{t("当前库为空或没有匹配目标的记录，请调整筛选、在线同步或导入真实数据。", "No matching records. Adjust filters, sync online or import real observations.")}</p>}{!!metadata?.excludedMissingTarget && <p>{t("缺少目标值已排除", "Excluded missing targets")}: {metadata.excludedMissingTarget}</p>}</div>
      <p className="text-[10px] leading-relaxed text-slate-500">{t("切换数据源或目标会重置当前轮次。", "Changing source/objective resets the run.")}</p>
      <MethodNote lang={lang}>{t("保真度是方法层级标签，不代表已经证明的精度。", "Fidelity labels describe method tiers, not proven accuracy.")}</MethodNote>
      {(query.source === "catalysis-hub" || query.source === "dual-fidelity") && <details className="text-xs"><summary className="cursor-pointer font-semibold text-teal-900">{t("导入有来源的数据", "Import sourced observations")}</summary><div className="mt-3 space-y-2"><p className="text-[10px] text-slate-500">{t("尚未预置实验数据。每条记录需要单位、方法、条件组和真实引用；模板中的空值必须补齐。", "No experimental data is preloaded. Supply units, method, cohort and real citations.")}</p><button type="button" disabled={locked} className="underline" onClick={() => void template()}>{t("填充 JSON 导入模板", "Load JSON template")}</button><label className="block">{t("读取 JSON 文件", "Read JSON file")}<input type="file" accept=".json,application/json" disabled={locked} onChange={async e => { const f = e.target.files?.[0]; if (f) { if (f.size > 8 * 1024 * 1024) setMessage("JSON exceeds8MB"); else setText(await f.text()); } }} /></label><textarea id="hub-import-json" aria-label={t("导入数据 JSON", "Import data JSON")} className={`${input} font-mono`} rows={7} value={text} onChange={e => setText(e.target.value)} spellCheck={false} /><button type="button" disabled={locked || !text} className="rounded-lg border border-teal-700 px-3 py-2 text-teal-900 disabled:opacity-40" onClick={() => void importData()}>{t("校验并写入本地库", "Validate and import")}</button></div></details>}
      {query.source === "dual-fidelity" && <div className="rounded-xl border border-teal-100 p-3 text-xs"><h3 className="font-semibold">{t("10 组实验偏差校准", "10-group experimental calibration")}</h3><p className="mt-2 text-[10px] text-slate-500">{t("同目标、单位和配对依据；按组成隔离，训练与独立留出分开。校准不会改写原始观测。", "Same target/units/basis, split by composition; original observations are preserved.")}</p><button type="button" disabled={locked || !cohort || (local?.count ?? 0) < 10} onClick={() => void calibrate()} className="mt-2 rounded-lg bg-teal-50 px-3 py-2 text-teal-900 disabled:opacity-30">{t("拟合常数偏差", "Fit constant bias")}</button>{calibration && <div className="mt-2 space-y-1" role="status"><p>Δ = {calibration.correction.toPrecision(6)} {calibration.unit}</p><p>{t("校准 / 留出组", "Calibration / holdout groups")}: {calibration.calibrationGroups} / {calibration.validationGroups}</p>{calibration.validation ? <><p>DFT MAE: {calibration.validation.baselineMAE.toPrecision(5)}</p><p>{t("修正后 MAE", "Corrected MAE")}: {calibration.validation.correctedMAE.toPrecision(5)}</p></> : <p>{t("独立留出不足，尚无验证指标。", "Insufficient independent holdout for validation.")}</p>}<p className="text-[10px]">{calibration.note}</p></div>}</div>}
      {calibration && query.source === "dual-fidelity" && onCalibration && <div className="research-calibration-toggle"><label><input type="checkbox" checked={!!calibrationEnabled} onChange={e => onCalibration(calibration, e.target.checked)} />校准预测：DFT → 实验尺度</label><p>Δ = {calibration.correction.toPrecision(5)} {calibration.unit} · 启用后10组校准记录计入已观测。</p></div>}
      {message && <p role="alert" className="break-words rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{message}</p>}
    </div>
  </section>;
}
