import { useEffect, useMemo, useRef, useState } from "react";
import { displayAtoms } from "../structures/geometry";
import { MAX_STRUCTURE_BYTES, type CrystalStructure } from "../structures/types";
import { asCrystalStructure, fromCrystalStructure, validatePool } from "../umlip/configurations";
import { demoConfigurations } from "../umlip/examples";
import type { ConfigurationInput, ConfigurationStatus, UmlipCapabilities, UmlipRun } from "../umlip/types";
import StructureViewer from "./StructureViewer";
import "./structure.css";
import "./umlip.css";
import MethodNote from "./MethodNote";
import type { Restore, UmlipArchive, StructureDraft } from "../research/types";
import { wrapFractional } from "../structures/geometry";

async function api<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/umlip${url}`, { ...init, headers: { "Content-Type": "application/json", ...init.headers } });
  let data: any;
  try { data = await response.json(); } catch { throw new Error("uMLIP 服务未就绪，请确认运行的是当前工作树的开发服务。"); }
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}
const number = (n?: number | null, digits = 6) => n == null || !Number.isFinite(n) ? "—" : Number(n.toPrecision(digits)).toString();
const labels: Record<ConfigurationStatus, string> = { pending: "未计算", running: "弛豫中", converged: "已收敛", unconverged: "未收敛", failed: "失败", cancelled: "已取消" };

function parseFile(file: File, workers: Set<Worker>): Promise<CrystalStructure[]> {
  return file.text().then(text => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("../structures/parse.worker.ts", import.meta.url), { type: "module" });
    workers.add(worker);
    const cleanup = () => { clearTimeout(timer); workers.delete(worker); worker.terminate(); };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${file.name}: 结构解析超过 10 秒。`)); }, 10000);
    worker.onmessage = event => { cleanup(); event.data.error ? reject(new Error(`${file.name}: ${event.data.error}`)) : resolve(event.data.structures); };
    worker.onerror = () => { cleanup(); reject(new Error(`${file.name}: 解析器加载失败。`)); };
    worker.postMessage({ text, filename: file.name, format: "auto" });
  }));
}

export default function UmlipPanel({ open, onClose, lang, enqueue, restored, onState, onUseStructure }: {
  open: boolean; onClose(): void; lang: "zh" | "en"; enqueue?: Restore<ConfigurationInput[]>; restored?: Restore<UmlipArchive>;
  onState?(state: UmlipArchive): void; onUseStructure?(draft: StructureDraft, action: "xrd" | "geometry"): void;
}) {
  const zh = lang === "zh", t = (a: string, b: string) => zh ? a : b;
  const dialog = useRef<HTMLDialogElement>(null);
  const workers = useRef(new Set<Worker>());
  const operation = useRef(0);
  const restoreRequest = useRef<AbortController | null>(null);
  const cancelRequests = useRef(new Set<string>());
  const [capabilities, setCapabilities] = useState<UmlipCapabilities | null>(null);
  const [candidates, setCandidates] = useState<ConfigurationInput[]>([]);
  const [run, setRun] = useState<UmlipRun | null>(null);
  const [archiveFiles, setArchiveFiles] = useState<NonNullable<UmlipArchive["files"]>>({});
  const [history, setHistory] = useState<{ id: string; status: string; createdAt: string; converged: number }[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [showInitial, setShowInitial] = useState(false);
  const [selectedAtoms, setSelectedAtoms] = useState<number[]>([]);
  const [budget, setBudget] = useState(6);
  const [batchSize, setBatchSize] = useState(2);
  const [fmax, setFmax] = useState(0.08);
  const [maxSteps, setMaxSteps] = useState(100);
  const [parsing, setParsing] = useState(false);
  const [posting, setPosting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkVersion, setCheckVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const busy = posting || run?.status === "running";
  const editing = busy || parsing || restoring;
  const rows = run?.candidates ?? candidates;
  const selected = rows.find(c => c.id === selectedId) ?? rows[0];
  const observed = run?.candidates.find(c => c.id === selected?.id);
  const viewStructure = useMemo(() => {
    if (!selected) return null;
    const s = !showInitial && observed?.result ? observed.result.structure
      : !showInitial && observed?.progress ? { ...selected.structure, fractional: observed.progress.fractional } : selected.structure;
    return asCrystalStructure(s, selected.name, `${selected.source} · ${showInitial ? "initial coordinates" : "MLIP calculation coordinates"}`);
  }, [selected, observed, showInitial]);
  const atoms = useMemo(() => viewStructure ? displayAtoms(viewStructure, 1) : [], [viewStructure]);
  const converged = run?.candidates.filter(c => c.status === "converged").length ?? 0;
  const attempted = run?.candidates.filter(c => c.status !== "pending").length ?? 0;
  const hydratedToken = useRef(0);
  useEffect(() => {
    if (!restored || hydratedToken.current === restored.token) return;
    hydratedToken.current = restored.token; operation.current++; restoreRequest.current?.abort();
    const s = restored.value; setCandidates(s.candidates); setRun(s.run); setSelectedId(s.selectedId ?? ""); setShowInitial(s.showInitial);
    setBudget(s.budget); setBatchSize(s.batchSize); setFmax(s.fmax); setMaxSteps(s.maxSteps); setArchiveFiles(s.files ?? {}); setPosting(false); setError(null);
  }, [restored?.token]);
  useEffect(() => { onState?.({ candidates, run, selectedId, showInitial, budget, batchSize, fmax, maxSteps, files: archiveFiles }); },
    [candidates, run, selectedId, showInitial, budget, batchSize, fmax, maxSteps, archiveFiles]);
  useEffect(() => {
    if (!enqueue) return;
    if (editing) { setError("请先结束当前构型计算，再加入新构型。"); return; }
    try {
      const next = [...candidates, ...enqueue.value];
      if (next.length > 32) throw new Error("构型队列最多32个。");
      if (next.length > 1) validatePool(next);
      setCandidates(next); setRun(null); setArchiveFiles({}); setSelectedId(next.at(-1)!.id); setBudget(Math.min(next.length, 6)); setShowInitial(true); setError(null);
    } catch (e) { setError((e as Error).message); }
  }, [enqueue?.token]);
  function useStructure(action: "xrd" | "geometry") {
    if (!viewStructure || !selected) return;
    onUseStructure?.({ structure: viewStructure, recordKey: selected.origin?.recordKey,
      parentStructureHash: selected.origin?.structureHash, stage: !showInitial && observed?.result ? "relaxed" : "initial",
      runId: run?.id, candidateId: selected.id, modelSha256: run?.model?.sha256 }, action);
  }
  function downloadArchive(id: string, key: "poscar" | "trajectory") {
    const value = archiveFiles[id]?.[key]; if (!value) return;
    const url = URL.createObjectURL(new Blob([value], { type: "text/plain" })), a = document.createElement("a");
    a.href = url; a.download = `${id}-${key === "poscar" ? "relaxed.POSCAR" : "trajectory.jsonl"}`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function perturbSeed() {
    if (editing || !candidates.length) return;
    const seed = candidates[0], next: ConfigurationInput = { ...structuredClone(seed), id: `cfg-${Date.now().toString(36)}`,
      name: seed.name + " · 位移构型", source: seed.source + " · 0.005 fractional displacement" };
    next.structure.fractional = next.structure.fractional.map((row, i) => wrapFractional(row.map((v, j) => v + (next.structure.movable[i][j] ? .005 * ((i + j) % 2 ? 1 : -1) : 0)) as [number, number, number]));
    const checked = validatePool([...candidates, next]); setCandidates(checked); setRun(null); setArchiveFiles({}); setSelectedId(next.id); setBudget(Math.min(checked.length, 6));
  }

  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => { setSelectedAtoms([]); }, [selectedId]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setChecking(true);
    void Promise.allSettled([api<UmlipCapabilities>("/capabilities", { signal: controller.signal }), api<typeof history>("/runs", { signal: controller.signal })])
      .then(([cap, runs]) => {
        if (controller.signal.aborted) return;
        if (cap.status === "fulfilled") setCapabilities(cap.value); else setError(cap.reason.message);
        if (runs.status === "fulfilled") setHistory(runs.value); else setError(runs.reason.message);
        setChecking(false);
      });
    return () => controller.abort();
  }, [open, checkVersion]);
  useEffect(() => () => {
    operation.current++; restoreRequest.current?.abort();
    for (const worker of workers.current) worker.terminate(); workers.current.clear();
  }, []);
  useEffect(() => {
    if (!run || run.status === "running") return;
    const controller = new AbortController();
    void api<typeof history>("/runs", { signal: controller.signal }).then(setHistory).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [run?.id, run?.status]);
  useEffect(() => {
    if (!run || run.status !== "running") return;
    const id = run.id, controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<UmlipRun>(`/runs/${id}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setRun(current => current?.id === id && current.status === "running" ? next : current);
        if (next.status === "running") timer = setTimeout(poll, 500);
      } catch (e) { if (!controller.signal.aborted) { setError((e as Error).message); timer = setTimeout(poll, 1500); } }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [run?.id, run?.status]);

  async function importFiles(files: FileList | null) {
    if (!files?.length || editing) return;
    const version = ++operation.current;
    setParsing(true); setError(null);
    try {
      if (files.length > 32) throw new Error("首版最多 32 个候选构型。");
      const next: ConfigurationInput[] = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_STRUCTURE_BYTES) throw new Error(`${file.name}: 文件超过 5 MB。`);
        const structures = await parseFile(file, workers.current);
        if (version !== operation.current) return;
        for (const structure of structures) next.push({ id: `cfg-${next.length}`, name: structure.name || file.name,
          source: `${file.name}${structure.source.blockName ? ` · ${structure.source.blockName}` : ""}`, structure: fromCrystalStructure(structure) });
        if (next.length > 32) throw new Error("多个 CIF 数据块合计超过 32 个候选。");
      }
      const checked = validatePool(next);
      setCandidates(checked); setRun(null); setArchiveFiles({}); setBudget(Math.min(checked.length, 6)); setSelectedId(checked[0].id); setShowInitial(true);
    } catch (e) { if (version === operation.current) setError((e as Error).message); }
    finally { if (version === operation.current) setParsing(false); }
  }
  function loadDemo() {
    if (editing) return;
    operation.current++; restoreRequest.current?.abort();
    setError(null); const pool = demoConfigurations(); setCandidates(pool); setRun(null); setArchiveFiles({}); setBudget(pool.length); setSelectedId(pool[0].id); setShowInitial(true);
  }
  async function start() {
    if (editing) return;
    const version = ++operation.current;
    setPosting(true); setError(null);
    try {
      const next = await api<UmlipRun>("/runs", { method: "POST", body: JSON.stringify({ candidates, settings: { budget, batchSize,
        initialSamples: Math.min(2, budget), fmax, maxSteps, seed: 42 } }) });
      if (version === operation.current) { setRun(next); setSelectedId(next.candidates[0].id); setShowInitial(false); }
    } catch (e) { if (version === operation.current) setError((e as Error).message); }
    finally { if (version === operation.current) setPosting(false); }
  }
  async function cancel() {
    if (!run || run.status !== "running" || cancelRequests.current.has(run.id)) return;
    const id = run.id, version = operation.current;
    cancelRequests.current.add(id); setCancellingId(id);
    try {
      const next = await api<UmlipRun>(`/runs/${id}/cancel`, { method: "POST" });
      if (version === operation.current) setRun(current => current?.id === id ? next : current);
    } catch (e) { if (version === operation.current) setError((e as Error).message); }
    finally {
      cancelRequests.current.delete(id);
      if (version === operation.current) setCancellingId(current => current === id ? null : current);
    }
  }
  async function restore(id: string) {
    if (!id || busy || parsing) return;
    const version = ++operation.current, controller = new AbortController();
    restoreRequest.current?.abort(); restoreRequest.current = controller; setRestoring(true);
    try {
      const next = await api<UmlipRun>(`/runs/${id}`, { signal: controller.signal });
      if (controller.signal.aborted || version !== operation.current) return;
      setRun(next); setArchiveFiles({});
      setCandidates(next.candidates.map(({ id, name, source, structure, origin }) => ({ id, name, source, structure, origin })));
      setBudget(next.settings.budget); setBatchSize(next.settings.batchSize); setFmax(next.settings.fmax); setMaxSteps(next.settings.maxSteps);
      setSelectedId(next.candidates[0].id); setShowInitial(false); setError(null);
    } catch (e) { if (!controller.signal.aborted && version === operation.current) setError((e as Error).message); }
    finally { if (version === operation.current) setRestoring(false); }
  }

  return <dialog ref={dialog} className="umlip-dialog" onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="umlip-header"><div><h2>{t("同成分构型 · uMLIP 主动学习", "Same-composition uMLIP active learning")}</h2>
      <p>{t("固定晶胞 · 真实本地 MACE 弛豫 · 最小化构型能量", "Fixed cell · real local MACE relaxation · energy minimization")}</p></div>
      <button type="button" onClick={onClose} aria-label={t("关闭 uMLIP 面板", "Close uMLIP panel")}>✕</button></header>
    <div className="umlip-content">
      <MethodNote lang={lang}>{t("仅已收敛计算参与 GPR 训练；第一条收敛结果固定为相对能参考。结果属于 MLIP 势函数能量，与 DFT 带隙/形成能分别记录。", "Only converged calculations train GPR. The first converged result fixes the reference; MLIP energies are tracked separately from DFT properties.")}</MethodNote>
      {error && <p role="alert" className="umlip-error">{error}</p>}
      <section className="umlip-settings" aria-label={t("uMLIP 计算设置", "uMLIP settings")}>
        <div className="umlip-toolbar">
          <label className="umlip-file">{t("导入多个 CIF / POSCAR / CONTCAR", "Import CIF / POSCAR / CONTCAR files")}<input type="file" multiple disabled={editing} onChange={e => { void importFiles(e.target.files); e.target.value = ""; }} /></label>
          <button type="button" disabled={editing} onClick={loadDemo}>{t("载入 6 个 SrTiO₃ 坐标示例", "Load 6 SrTiO₃ coordinate examples")}</button>
          <button type="button" disabled={editing} onClick={() => {
            operation.current++; restoreRequest.current?.abort(); setCandidates([]); setRun(null); setArchiveFiles({});
            setSelectedId(""); setSelectedAtoms([]); setBudget(6); setShowInitial(true); setError(null);
          }}>{t("新建同成分队列", "New composition queue")}</button>
          <button type="button" disabled={editing || !candidates.length || candidates.length >= 32} onClick={perturbSeed}>{t("从首构型生成位移候选", "Create a displaced candidate")}</button>
        </div>
        <p className="umlip-small">{parsing ? t("正在解析结构…", "Parsing structures…") : t("同元素计数、原子顺序与运动约束 · 满占位有序晶胞 · 最多 32 构型 / 128 原子", "Same atom counts, element order and constraints · ordered full occupancy · up to 32 configurations / 128 atoms")}</p>
        <div className="umlip-fields">
          <label>{t("计算次数预算", "Evaluation budget")}<input aria-label="uMLIP 计算次数预算" type="number" min={1} max={candidates.length || 32} value={budget} disabled={busy} onChange={e => setBudget(Number(e.target.value))} /></label>
          <label>{t("每轮构型数", "Batch size")}<input aria-label="uMLIP 每轮构型数" type="number" min={1} max={4} value={batchSize} disabled={busy} onChange={e => setBatchSize(Number(e.target.value))} /></label>
          <label>fmax / eV·Å⁻¹<input aria-label="uMLIP 力收敛阈值" type="number" min={0.005} max={1} step={0.005} value={fmax} disabled={busy} onChange={e => setFmax(Number(e.target.value))} /></label>
          <label>{t("最大离子步数", "Maximum ionic steps")}<input aria-label="uMLIP 最大离子步数" type="number" min={1} max={200} value={maxSteps} disabled={busy} onChange={e => setMaxSteps(Number(e.target.value))} /></label>
        </div>
        <div className="umlip-toolbar">
          <button type="button" className="umlip-primary" onClick={() => void start()} disabled={editing || candidates.length < 2 || !capabilities?.configured}>{t("开始真实 uMLIP 闭环", "Start real uMLIP loop")}</button>
          {run?.status === "running" && <button type="button" className="umlip-danger" disabled={cancellingId === run.id} onClick={() => void cancel()}>{cancellingId === run.id ? t("正在取消…", "Cancelling…") : t("取消计算", "Cancel calculation")}</button>}
          <span className="umlip-small">{capabilities?.modelLabel ?? t("正在检查服务…", "Checking service…")}</span>
          <button type="button" disabled={checking} onClick={() => { setError(null); setCheckVersion(v => v + 1); }}>{t("重新检查服务", "Recheck service")}</button>
        </div>
        {capabilities && <p className="umlip-small">{capabilities.message}</p>}
        {history.length > 0 && <label className="umlip-history">{t("恢复已保存运行", "Open saved run")}<select value="" disabled={editing} onChange={e => void restore(e.target.value)}><option value="">{restoring ? t("正在恢复…", "Restoring…") : t("选择运行记录…", "Select a saved run…")}</option>{history.slice(0, 30).map(h => <option key={h.id} value={h.id}>{new Date(h.createdAt).toLocaleString()} · {h.status} · {h.converged} converged · {h.id.slice(0, 8)}</option>)}</select></label>}
      </section>

      {run && <section className="umlip-summary" aria-live="polite">
        <div><span>{t("运行状态", "Run status")}</span><strong>{({ running: "计算中", completed: "已完成", cancelled: "已取消", failed: "失败" })[run.status]}</strong></div>
        <div><span>{t("已尝试 / 预算", "Attempted / budget")}</span><strong>{attempted} / {run.settings.budget}</strong></div>
        <div><span>{t("有效收敛标签", "Converged labels")}</span><strong>{converged}</strong></div>
        <div><span>{t("最佳 ΔE / eV·atom⁻¹", "Best ΔE / eV·atom⁻¹")}</span><strong>{number(run.bestRelativeEvPerAtom)}</strong></div>
        <div><span>{t("端到端耗时 / s", "Wall time / s")}</span><strong>{number(run.wallSeconds, 5)}</strong></div>
        <div><span>{t("模型加载 / s", "Model load / s")}</span><strong>{number(run.modelLoadSeconds, 5)}</strong></div>
        {run.error && <p className="umlip-error">{run.error}</p>}
      </section>}
      {run?.reference && <p className="umlip-small">{t("固定参考", "Fixed reference")}: {run.reference.id} · Eref = {number(run.reference.energyEv, 10)} eV · {run.atomCount} atoms · ΔE = E − Eref</p>}

      <div className="umlip-table-wrap"><table className="umlip-table"><thead><tr>
        {[t("构型", "Configuration"), t("状态 / 轮次", "Status / round"), "E / eV·atom⁻¹", "ΔE / eV·atom⁻¹", "fmax / eV·Å⁻¹", t("离子步", "Steps"), t("弛豫 / s", "Relaxation / s"), t("输出", "Outputs")].map(h => <th key={h}>{h}</th>)}
      </tr></thead><tbody>{rows.map(row => {
        const record = run?.candidates.find(c => c.id === row.id), result = record?.result, progress = record?.progress;
        return <tr key={row.id} className={selected?.id === row.id ? "umlip-selected" : ""}>
          <td><button type="button" onClick={() => { setSelectedId(row.id); setShowInitial(false); }}>{row.name}</button><small>{row.id}{record?.selectionReason ? ` · ${record.selectionReason}` : ""}</small>{record?.error && <small className="umlip-error">{record.error}</small>}</td>
          <td><span className={`umlip-status umlip-status-${record?.status ?? "pending"}`}>{record ? (zh ? labels[record.status] : record.status) : t("未计算", "Not evaluated")}</span>{record?.round ? ` / ${record.round}` : ""}</td>
          <td>{number(result?.energyPerAtomEv ?? (progress ? progress.energyEv / row.structure.elements.length : undefined), 9)}</td>
          <td>{number(record?.relativeEnergyPerAtomEv, 8)}</td><td>{number(result?.maxForceEvAngstrom ?? progress?.maxForceEvAngstrom, 5)}</td>
          <td>{result?.steps ?? progress?.step ?? "—"}</td><td>{number(result?.elapsedSeconds ?? progress?.elapsedSeconds, 5)}</td>
          <td>{run && <>{result && <>{archiveFiles[row.id]?.poscar ? <button type="button" onClick={() => downloadArchive(row.id, "poscar")}>POSCAR</button> : <a href={`/api/umlip/runs/${run.id}/candidates/${row.id}/poscar`}>POSCAR</a>}<br /></>}{(result || progress) && (archiveFiles[row.id]?.trajectory ? <button type="button" onClick={() => downloadArchive(row.id, "trajectory")}>{t("逐步轨迹", "Trajectory")}</button> : <a href={`/api/umlip/runs/${run.id}/candidates/${row.id}/trajectory`}>{t("逐步轨迹", "Trajectory")}</a>)}</>}</td>
        </tr>;
      })}</tbody></table></div>

      {viewStructure && <section className="umlip-preview">
        <div className="umlip-toolbar"><h3>{selected?.name}</h3><label><input type="checkbox" checked={showInitial} onChange={e => setShowInitial(e.target.checked)} />{t("查看初始坐标", "Show initial coordinates")}</label>
          <span className="umlip-small">{showInitial ? t("初始模型输入", "Initial model input") : observed?.status === "running" ? t("最新离子步坐标", "Latest ionic-step coordinates") : t("模型弛豫／输入结构", "MLIP relaxed / input structure")}</span>
          {onUseStructure && <><button type="button" disabled={busy} onClick={() => useStructure("xrd")}>当前结构 → XRD</button><button type="button" disabled={busy} onClick={() => useStructure("geometry")}>几何量 → 白盒公式</button></>}</div>
        <StructureViewer structure={viewStructure} atoms={atoms} repeats={1} showCell showNeighbors={false} cutoff={2.5} selected={selectedAtoms} active={open}
          onSelect={index => setSelectedAtoms(previous => previous.includes(index) ? previous.filter(i => i !== index) : [...previous.slice(-1), index])} />
      </section>}

      {run && <details className="umlip-provenance"><summary>{t("方法、参考与可追溯记录", "Method, reference and provenance")}</summary>
        <p>GPR · minimize E/atom · LCB = μ − 2σ · {run.descriptorVersion} · seed {run.settings.seed} · FIRE · fixed cell · CPU/float64</p>
        <p>{t("几何描述符来自初始晶胞的周期最短原子对距离及元素加权 RBF 统计；不是势函数隐空间，也不保证结构唯一性。运动约束按 Direct 基矢保留；受力阈值作用于可动自由度。", "Initial-geometry descriptors use periodic pair distances and element-weighted RBF statistics, not model embeddings or unique structure identifiers. Direct-basis motion constraints are retained; force convergence uses free degrees of freedom.")}</p>
        <p>{t("预算计入每次计算尝试；失败和未收敛结果不训练。关闭面板不停止服务端运行，请使用“取消计算”。结果保存在本地 umlip-results；模型能量、DFT 带隙和实验数据不混用。", "Every attempted calculation consumes budget. Failed/unconverged results do not train. Closing the panel does not stop the server run; use Cancel. Results persist locally under umlip-results, separately from DFT band gaps and experiments.")}</p>
        <pre>{JSON.stringify({ runId: run.id, model: run.model, reference: run.reference, settings: run.settings, surrogateSeconds: run.surrogateSeconds,
          inputHashes: run.candidates.map(c => ({ id: c.id, sha256: c.inputSha256 })), rounds: run.rounds }, null, 2)}</pre>
      </details>}
    </div>
  </dialog>;
}
