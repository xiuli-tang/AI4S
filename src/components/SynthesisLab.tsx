import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Download, FlaskConical, LoaderCircle, Play, RefreshCw, Upload, X } from "lucide-react";
import type { Material } from "../types";
import type { CrystalStructure } from "../structures/types";
import { displayAtoms, structureComposition } from "../structures/geometry";
import { materialRecordKey } from "../materialContext";
import { resolveSynthesisReference } from "../synthesis/reference";
import { feedbackRejectionReason } from "../synthesis/feedback";
import { compareSpectrum, demoCrystal, isStrontiumTitanate, parseExperimentalSpectrum, sameComposition, spectrumIsDemonstration, spectrumText, synthesisRequest, xrdPayload } from "../synthesis/client";
import { experimentHistory, saveExperiment } from "../synthesis/records";
import type { ComparisonResult, ExperimentRecord, LabRequest, PreflightResult, ReferenceBinding, SynthesisFeedback, XrdPoint, XrdResult } from "../synthesis/types";
import XrdPlot from "./XrdPlot";
import MethodNote from "./MethodNote";
import type { Restore } from "../research/types";
import type { StabilityInput } from "../engine/pareto/ParetoData";
import "./synthesis.css";

const StructureViewer = lazy(() => import("./StructureViewer"));
interface Props {
  open: boolean; onClose(): void; request: LabRequest | null; materials: Material[];
  onFeedback(feedback: SynthesisFeedback): boolean;
  restored?: Restore<ExperimentRecord>; onRecord?(record: ExperimentRecord): void; stability?: StabilityInput[];
}
function download(filename: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function SynthesisLab({ open, onClose, request, materials, onFeedback, restored, onRecord, stability }: Props) {
  const dialog = useRef<HTMLDialogElement>(null), input = useRef<HTMLInputElement>(null);
  const operation = useRef(0), active = useRef<AbortController | null>(null), autoDemo = useRef(false);
  const readyFor = useRef<number | null>(null);
  const [target, setTarget] = useState<LabRequest | null>(request);
  const [structure, setStructure] = useState<CrystalStructure | null>(null);
  const [reference, setReference] = useState<ReferenceBinding | null>(null);
  const [xrd, setXrd] = useState<XrdResult | null>(null), [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [temperature, setTemperature] = useState(900), [atmosphere, setAtmosphere] = useState("air");
  const [wavelength, setWavelength] = useState("CuKa"), [fwhm, setFwhm] = useState(.16);
  const [range, setRange] = useState<[number, number]>([10, 80]);
  const [points, setPoints] = useState<XrdPoint[]>([]), [filename, setFilename] = useState("");
  const [comparison, setComparison] = useState<ComparisonResult | null>(null), [demoData, setDemoData] = useState(false);
  const [busy, setBusy] = useState(""), [error, setError] = useState("");
  const [sampleId, setSampleId] = useState("SAMPLE-001"), [sent, setSent] = useState(false);
  const [records, setRecords] = useState<ExperimentRecord[]>([]), [currentRecord, setCurrentRecord] = useState<ExperimentRecord | null>(null);
  const [selectedAtom, setSelectedAtom] = useState<number[]>([]);
  const [presentation, setPresentation] = useState(false);
  const restoredToken = useRef(0), archiveIdentity = useRef("");
  const atoms = useMemo(() => structure ? displayAtoms(structure, 1) : [], [structure]);
  const selectedMaterial = materials.find(m => m.id === target?.materialId && materialRecordKey(m) === target?.recordKey);
  const name = selectedMaterial?.formula || target?.formula || structure?.name || "选择材料";
  const feedbackReason = feedbackRejectionReason(selectedMaterial, currentRecord?.reference.binding ?? reference ?? undefined, currentRecord?.demo ?? demoData);
  const stabilityEvaluation = stability?.find(row => row.recordKey === target?.recordKey);
  const stabilityIdentity = JSON.stringify(stabilityEvaluation);
  const setupIdentity = JSON.stringify([target?.requestId, temperature, atmosphere, wavelength, range[0], range[1], fwhm, stabilityIdentity]);
  function restoreRecord(record: ExperimentRecord) {
    active.current?.abort(); operation.current++; autoDemo.current = false;
    const pattern = record.reference.xrd.pattern, id = Date.now();
    const bound = record.reference.binding;
    const next: LabRequest = { requestId: id, materialId: record.materialId, formula: record.formula,
      recordKey: bound?.recordKey, structureRef: bound?.structureRef, demonstration: record.demo && bound?.kind === "demo",
      structure: bound?.kind === "record" ? undefined : record.reference.structure, referenceBinding: bound };
    const evalIdentity = JSON.stringify(stability?.find(row => row.recordKey === bound?.recordKey));
    archiveIdentity.current = JSON.stringify([id, record.temperature, record.atmosphere, pattern.wavelength, pattern.min, pattern.max, pattern.fwhm, evalIdentity]);
    readyFor.current = id; setTarget(next); setStructure(record.reference.structure); setReference(bound ?? null);
    setXrd(record.reference.xrd); setPreflight(record.reference.preflight); setTemperature(record.temperature); setAtmosphere(record.atmosphere);
    setWavelength(pattern.wavelength); setRange([pattern.min, pattern.max]); setFwhm(pattern.fwhm);
    setPoints(record.points); setFilename(record.filename); setComparison(record.comparison); setDemoData(record.demo); setCurrentRecord(record);
    setSampleId(record.feedback?.sampleId ?? "SAMPLE-001"); setSent(Boolean(record.feedback)); setBusy(""); setError(""); onRecord?.(record);
  }

  function changeSetup(update: () => void) {
    archiveIdentity.current = "";
    active.current?.abort(); operation.current++; readyFor.current = null;
    setXrd(null); setReference(null); setCurrentRecord(null); setComparison(null); setSent(false); update();
  }
  function close() {
    active.current?.abort(); operation.current++; autoDemo.current = false; readyFor.current = null; onClose();
  }
  function selectCandidate(id: string) {
    if (!id) {
      changeSetup(() => setTarget({ requestId: Date.now(), structure: structure || undefined }));
      return;
    }
    const material = materials.find(m => m.id === id);
    if (!material) return;
    const imported = target?.structure && !target.demonstration && target.structure.source.filename !== "demo.POSCAR" ? target.structure : undefined;
    if (imported && !sameComposition(structureComposition(imported), material.composition)) {
      setError("所选候选与导入晶胞组成不同，请选择对应材料。"); return;
    }
    changeSetup(() => setTarget({ requestId: Date.now(), materialId: material.id, formula: material.formula,
      composition: material.composition, source: material.source, recordKey: materialRecordKey(material), structureRef: material.structureRef, structure: imported }));
  }

  useEffect(() => { setTarget(request); setPresentation(false); }, [request?.requestId]);
  useEffect(() => { if (restored && restored.token !== restoredToken.current) { restoredToken.current = restored.token; restoreRecord(restored.value); } }, [restored?.token]);
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
    if (!open) active.current?.abort();
    if (open) void experimentHistory().then(setRecords).catch(() => {});
  }, [open]);
  useEffect(() => { if (archiveIdentity.current === setupIdentity) return; setPoints([]); setFilename(""); setComparison(null); setCurrentRecord(null); setSent(false); }, [target?.requestId]);
  useEffect(() => {
    if (!open || !target) return;
    if (archiveIdentity.current === setupIdentity) { readyFor.current = target.requestId; return; }
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    const id = ++operation.current;
    readyFor.current = null;
    setBusy("正在准备晶胞与计算衍射峰"); setError(""); setComparison(null); setCurrentRecord(null); setReference(null); setStructure(null); setXrd(null); setPreflight(null); setSent(false);
    void (async () => {
      const resolved = await resolveSynthesisReference(target, selectedMaterial, controller.signal);
      const crystal = resolved.structure;
      if (id !== operation.current) return;
      setStructure(crystal); setReference(resolved.binding); setSelectedAtom([]);
      const composition = structureComposition(crystal);
      const [diffraction, screening] = await Promise.all([
        synthesisRequest<XrdResult>("xrd", xrdPayload(crystal, { wavelength, min: range[0], max: range[1], fwhm }), controller.signal),
        synthesisRequest<PreflightResult>("preflight", { composition, materialId: selectedMaterial ? target.materialId : undefined,
          structureRef: selectedMaterial?.structureRef, source: target.source, allowDemo: resolved.binding.kind === "demo",
          stabilityEvaluation, temperature, atmosphere }, controller.signal),
      ]);
      if (id !== operation.current) return;
      readyFor.current = target.requestId;
      setXrd(diffraction); setPreflight(screening);
    })().catch(reason => { if (!controller.signal.aborted && id === operation.current) setError(reason.message); })
      .finally(() => { if (id === operation.current) setBusy(""); });
    return () => { controller.abort(); operation.current++; };
  }, [open, target, temperature, atmosphere, wavelength, range[0], range[1], fwhm, stabilityIdentity]);

  async function analyze(nextPoints = points, nextFilename = filename, isDemo = demoData, expectedOperation = operation.current) {
    if (!xrd || !structure || !reference || expectedOperation !== operation.current || readyFor.current !== target?.requestId) return;
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    const id = ++operation.current;
    setBusy("正在对齐峰位并拟合候选物相"); setError(""); setSent(false);
    try {
      const result = await compareSpectrum(xrd, nextPoints, controller.signal);
      if (id !== operation.current) return;
      setComparison(result);
      const record: ExperimentRecord = { id: crypto.randomUUID(), materialId: target?.materialId || "", formula: name,
        filename: nextFilename, createdAt: new Date().toISOString(), demo: isDemo, temperature, atmosphere,
        points: nextPoints, comparison: result, reference: structuredClone({ structure, xrd, preflight, binding: reference }) };
      setCurrentRecord(record);
      onRecord?.(record);
      try { await saveExperiment(record); setRecords(await experimentHistory()); } catch { setError("比对结果已生成；浏览器保存失败，可导出报告或保存研究存档。"); }
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "比对失败"); }
    finally { if (id === operation.current) setBusy(""); }
  }
  async function loadFile(file?: File) {
    if (!file || !xrd) return;
    active.current?.abort(); const id = ++operation.current;
    setBusy("正在读取实验谱图"); setError("");
    try {
      if (file.size > 8*1024*1024) throw new Error("请使用小于 8 MB 的两列谱图文件。");
      const text = await file.text();
      if (id !== operation.current) return;
      const data = parseExperimentalSpectrum(text);
      const demonstration = spectrumIsDemonstration(text, file.name);
      setPoints(data); setFilename(file.name); setDemoData(demonstration); setComparison(null);
      await analyze(data, file.name, demonstration, id);
    } catch (reason) { if (id === operation.current) { setError(reason instanceof Error ? reason.message : "文件读取失败"); setBusy(""); } }
  }
  async function loadDemo(kind: "clean" | "impurity") {
    if (!xrd) return;
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    const id = ++operation.current;
    setBusy("正在生成实验演示样例"); setError("");
    try {
      const sample = await synthesisRequest<{ points: XrdPoint[]; filename: string }>("demo", { ...xrd, kind }, controller.signal);
      if (controller.signal.aborted || id !== operation.current) return;
      setPoints(sample.points); setFilename(sample.filename); setDemoData(true);
      await analyze(sample.points, sample.filename, true, id);
    } catch (reason) { if (!controller.signal.aborted && id === operation.current) { setError(reason instanceof Error ? reason.message : "演示加载失败"); setBusy(""); } }
  }
  useEffect(() => {
    if (xrd && !busy && autoDemo.current && readyFor.current === target?.requestId) { autoDemo.current = false; void loadDemo("clean"); }
  }, [xrd, busy]);

  function roadshow() {
    const material = materials.find(m => m.source === "mock" && isStrontiumTitanate(m.composition));
    autoDemo.current = true;
    setPresentation(true);
    changeSetup(() => {
      setTemperature(1000); setAtmosphere("air"); setWavelength("CuKa"); setFwhm(.16); setRange([10, 80]);
      setTarget({ requestId: Date.now(), materialId: material?.id, recordKey: material ? materialRecordKey(material) : undefined,
        source: material?.source, formula: "SrTiO₃", composition: { Sr: 1, Ti: 1, O: 3 }, structure: demoCrystal(), demonstration: true });
    });
  }
  async function feedback() {
    if (!comparison || !target?.materialId || !currentRecord) return;
    const reason = feedbackRejectionReason(selectedMaterial, currentRecord.reference.binding, currentRecord.demo);
    if (reason || !sampleId.trim()) { setError(reason || "请填写实验样品编号。"); return; }
    const result: SynthesisFeedback = { materialId: target.materialId, formula: name, status: comparison.passed ? "pass" : "impurity",
      schemaVersion: 2, recordKey: target.recordKey, reference: structuredClone(currentRecord.reference.binding),
      score: comparison.score, mainFraction: comparison.mainFraction,
      prior: Math.max(.05, Math.min(1, comparison.mainFraction/100*comparison.score/100)),
      sampleId, filename: currentRecord.filename, createdAt: new Date().toISOString(), demo: currentRecord.demo };
    if (!onFeedback(result)) { setError("当前数据记录已变化或反馈缺少有效绑定，请重新分析。"); return; }
    setSent(true);
    const record = { ...currentRecord, feedback: result };
    setCurrentRecord(record);
    onRecord?.(record);
    try { await saveExperiment(record); setRecords(await experimentHistory()); } catch { setError("先验已更新；浏览器保存失败，请保存研究存档或导出报告。"); }
  }

  return <dialog ref={dialog} className={`synthesis-dialog ${presentation ? "synthesis-presentation" : ""}`} aria-labelledby="synthesis-title" onClose={close}>
    <header className="synthesis-header"><div className="synthesis-brand"><div className="synthesis-brand-icon"><FlaskConical size={25} /></div><div><span className="synthesis-kicker">FROM ATOMS TO EXPERIMENTS</span><h2 id="synthesis-title">合成预审与 XRD 实验室</h2><p>连接候选结构、合成预审与谱图比对</p></div></div>
      <div className="synthesis-header-actions">{presentation && <button type="button" onClick={() => setPresentation(false)}>完整工作台</button>}<button type="button" onClick={roadshow} disabled={!!busy}><Play size={14} />一键路演</button><button type="button" className="synthesis-close" aria-label="关闭合成实验室" onClick={close}><X size={21} /></button></div></header>
    <nav className="synthesis-steps" aria-label="实验闭环进度">{["候选材料", "合成预审", "XRD 干湿比对", "反馈主动学习"].map((label, index) => <div key={label} className={(index === 0 || index === 1 && preflight || index === 2 && comparison || index === 3 && sent) ? "done" : ""}><span>{(index === 0 || index === 1 && preflight || index === 2 && comparison || index === 3 && sent) ? <Check size={12} /> : index+1}</span>{label}{index < 3 && <ChevronRight size={14} />}</div>)}</nav>
    <div className="synthesis-body">
      <section className="synthesis-selection"><div><span className="synthesis-eyebrow">CANDIDATE</span><h3>{name}</h3><small>{target?.materialId || "本地导入结构"}</small></div>
        <label>关联候选<select aria-label="合成实验关联候选" value={target?.materialId || ""} disabled={!!busy} onChange={event => selectCandidate(event.target.value)}><option value="">独立结构 / 未关联</option>{materials.map(m => <option key={m.id} value={m.id}>{m.formula} · {m.id}</option>)}</select></label>
        {selectedMaterial && selectedMaterial.source !== "mock" && reference?.kind !== "record" && <button type="button" disabled={!!busy} onClick={() => changeSetup(() => setTarget({ ...target!, requestId: Date.now(), structure: undefined, demonstration: false }))}>加载候选对应数据库晶胞</button>}
        <div className="synthesis-source"><span className={reference?.kind === "demo" ? "demo" : ""}>{reference?.kind === "demo" ? "演示晶胞" : reference?.kind === "record" ? (structure?.source.providerLabel || "数据库对应晶胞") : "导入晶胞（仅分析）"}</span>{demoData && <span className="demo">演示实验谱</span>}</div>
      </section>
      {error && <div className="synthesis-error" role="alert">{error}<button type="button" onClick={roadshow}>载入演示</button></div>}
      {busy && <div className="synthesis-busy" role="status"><LoaderCircle size={15} className="spin" />{busy}</div>}
      <div className="synthesis-grid">
        <aside className="synthesis-left">
          <section className="synthesis-card synthesis-crystal"><div className="synthesis-card-title"><h3>原子结构</h3><span>{structure?.sites.length || "—"} sites</span></div>
            {structure ? <Suspense fallback={<p>正在加载晶胞…</p>}><StructureViewer structure={structure} atoms={atoms} repeats={1} showCell showNeighbors cutoff={2.7} selected={selectedAtom} active={open} onSelect={index => setSelectedAtom([index])} /></Suspense> : <div className="synthesis-placeholder">准备晶胞</div>}
          </section>
          <section className={`synthesis-card synthesis-grade grade-${preflight?.grade || "B"}`}><div className="synthesis-card-title"><h3>可合成性预审</h3><span>{preflight?.source === "data-hub" ? "快照 Ehull" : preflight?.source === "external" ? "共享稳定性评估" : preflight?.source === "materials-project" ? "Materials Project" : preflight?.source === "unavailable" ? "稳定性数据缺失" : "演示预审"}</span></div>
            <div className="synthesis-grade-main"><b>{preflight?.grade === "unknown" ? "?" : preflight?.grade || "—"}</b><div><strong>{preflight?.label || "正在预审"}</strong><p>综合评分 <em>{preflight?.score ?? "—"}</em> / 100</p></div></div>
            <div className="synthesis-energy"><span>能量高于凸包</span><b>{preflight?.energyAboveHull != null ? (preflight.energyAboveHull*1000).toFixed(1) : "—"}<small> meV/atom</small></b></div>
            {preflight?.factors.map(factor => <div className="synthesis-factor" key={factor.name}><div><span>{factor.name}</span><b>{factor.score}</b></div><i><span style={{ width: `${factor.score}%` }} /></i></div>)}
            <div className="synthesis-competitors"><small>关注的竞争相</small><div>{preflight?.competitors.map(phase => <span key={phase.formula}>{phase.formula}</span>)}</div></div>
          </section>
          <section className="synthesis-card synthesis-recipe"><h3>合成工艺窗口</h3><label>烧结温度 <b>{temperature} °C</b><input aria-label="烧结温度" type="range" min="400" max="1500" step="25" value={temperature} onChange={event => changeSetup(() => setTemperature(Number(event.target.value)))} /></label>
            <label>烧结气氛<select aria-label="烧结气氛" value={atmosphere} onChange={event => changeSetup(() => setAtmosphere(event.target.value))}><option value="air">空气</option><option value="oxygen">富氧</option><option value="inert">惰性气氛</option><option value="reducing">还原气氛</option></select></label><MethodNote>预审结合对应版本的 Ehull、温度与气氛进行启发式评分；工艺窗口需结合具体样品验证。</MethodNote></section>
        </aside>
        <div className="synthesis-right">
          <section className="synthesis-card synthesis-diffraction"><div className="synthesis-card-title"><div><span className="synthesis-eyebrow">DIFFRACTION FINGERPRINT</span><h3>理论与实验，一眼对照</h3></div><span>{xrd?.engine || "pymatgen"}</span></div>
            <div className="synthesis-xrd-controls"><label>射线<select aria-label="XRD 射线" value={wavelength} onChange={event => changeSetup(() => setWavelength(event.target.value))}><option value="CuKa">Cu Kα</option><option value="CuKa1">Cu Kα1</option><option value="MoKa">Mo Kα</option><option value="CoKa">Co Kα</option></select></label>
              <label>2θ<input aria-label="XRD 起始角" type="number" min="0" max={range[1]-1} value={range[0]} onChange={event => changeSetup(() => setRange([Number(event.target.value), range[1]]))} /><span>–</span><input aria-label="XRD 终止角" type="number" min={range[0]+1} max="160" value={range[1]} onChange={event => changeSetup(() => setRange([range[0], Number(event.target.value)]))} />°</label>
              <label>峰宽<input aria-label="XRD 峰宽" type="number" min="0.03" max="1.5" step="0.02" value={fwhm} onChange={event => changeSetup(() => setFwhm(Number(event.target.value)))} />°</label></div>
            {xrd ? <XrdPlot pattern={xrd.pattern} comparison={comparison} /> : <div className="synthesis-placeholder">计算理论衍射指纹…</div>}
            {comparison && <div className="synthesis-alignment"><span>自动峰位校正 {comparison.shift >= 0 ? "+" : ""}{comparison.shift.toFixed(3)}°</span><span>主要峰覆盖 {comparison.peakCoverage.toFixed(1)}%</span><span>拟合 RMSE {comparison.rmse.toFixed(2)}</span></div>}
          </section>
          <section className={`synthesis-upload ${busy ? "disabled" : ""}`} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (!busy) void loadFile(event.dataTransfer.files[0]); }}>
            <input ref={input} type="file" accept=".xy,.csv,.txt,.dat" hidden onChange={event => { void loadFile(event.target.files?.[0]); event.target.value = ""; }} />
            <div className="synthesis-upload-icon"><Upload size={24} /></div><div><h3>{filename || "把实验 XRD 拖到这里"}</h3><p>{filename ? `${points.length.toLocaleString()} 个数据点 · ${demoData ? "演示样例" : "实验文件"}` : ".xy / .csv · 两列 2θ 与强度 · 自动寻峰与对齐"}</p></div>
            <button type="button" disabled={!!busy || !xrd} onClick={() => input.current?.click()}>选择文件</button>
          </section>
          <div className="synthesis-demo-actions"><span>快速体验</span><button type="button" disabled={!!busy || !xrd} onClick={() => void loadDemo("clean")}>载入高纯相演示</button><button type="button" disabled={!!busy || !xrd} onClick={() => void loadDemo("impurity")}>载入含杂相演示</button>{points.length > 0 && <button type="button" onClick={() => download(filename || "experiment.xy", spectrumText(points, demoData), "text/plain")}><Download size={12} />下载谱图</button>}</div>
          {comparison ? <section className={`synthesis-card synthesis-result ${comparison.passed ? "pass" : "fail"}`} aria-label="XRD 比对结果">
            <div className="synthesis-result-heading"><div className="synthesis-signal">{comparison.passed ? <Check size={22} /> : <FlaskConical size={22} />}</div><div><span>{currentRecord?.demo ? "演示谱 · 参考模型比对" : "上传谱 · 参考模型比对"}</span><h3>{comparison.passed ? "谱图匹配符合阈值" : "谱图匹配不足 · 检查参考相与数据"}</h3></div><span className="synthesis-fit-label">谱图拟合</span></div>
            <div className="synthesis-metrics"><div><span>主相拟合占比</span><b>{comparison.mainFraction.toFixed(1)}<small>%</small></b></div><div><span>谱图一致性</span><b>{comparison.score.toFixed(1)}<small>/100</small></b></div><div><span>未解释的主相外峰</span><b>{comparison.unmatchedPeaks.length}<small> 个</small></b></div></div>
            <div className="synthesis-phasebar">{comparison.phases.filter(p => p.percent > .1).map((phase, i) => <div key={phase.name} style={{ width: `${phase.percent}%`, background: ["#2c9d88", "#e5b36e", "#8e9be8", "#bd8fc3"][i%4] }} title={`${phase.name}: ${phase.percent.toFixed(1)}%`} />)}</div>
            <div className="synthesis-phases">{comparison.phases.filter(p => p.percent > .1).map(phase => <span key={phase.name}>{phase.target ? "●" : "◦"} {phase.name} <b>{phase.percent.toFixed(1)}%</b></span>)}</div>
            {comparison.unmatchedPeaks.length > 0 && <p className="synthesis-extra-peaks">关注峰位：{comparison.unmatchedPeaks.slice(0, 8).map(p => `${p.twoTheta.toFixed(2)}°`).join(" · ")}</p>}
            <div className="synthesis-feedback-controls"><label>实验样品编号<input aria-label="实验样品编号" value={sampleId} onChange={event => setSampleId(event.target.value)} /></label>
              <button type="button" className="synthesis-feedback-button" disabled={sent || !!feedbackReason || !sampleId.trim() || !!busy} onClick={() => void feedback()}>{sent ? <Check size={15} /> : <RefreshCw size={15} />}{sent ? "已反馈 · 匹配先验已更新" : "反馈主动学习"}</button>
              {currentRecord && <button type="button" className="synthesis-export" aria-label="导出实验报告" onClick={() => download(`${sampleId || "sample"}-report.json`, JSON.stringify({ ...currentRecord, sampleId }, null, 2))}><Download size={15} /></button>}</div>
            {feedbackReason && <small role="status">{feedbackReason}</small>}
          </section> : <section className="synthesis-card synthesis-awaiting"><FlaskConical size={23} /><h3>等待一份实验谱，完成最后一公里</h3><p>拖入实验文件，或载入上方演示样例，即可查看主相占比、杂峰与反馈结果。</p></section>}
          <section className="synthesis-card synthesis-records"><div className="synthesis-card-title"><h3>实验记录</h3><span>{records.length} 次比对 · 浏览器本地保存</span></div>
            {records.length ? records.slice(0, 5).map(record => <div className="synthesis-record" key={record.id}><span className={record.comparison.passed ? "record-pass" : "record-fail"}>{record.comparison.passed ? "✓" : "!"}</span><div><b>{record.formula}</b><small>{record.demo ? "演示谱 · " : "上传谱 · "}{record.filename} · {new Date(record.createdAt).toLocaleString()}</small></div><strong>{record.comparison.mainFraction.toFixed(1)}%</strong><button type="button" onClick={() => restoreRecord(record)}>载入</button><button type="button" aria-label={`导出 ${record.filename} 报告`} onClick={() => download(`${record.id}.json`, JSON.stringify(record, null, 2))}><Download size={14} /></button></div>) : <p>每次比对将保存谱图、工艺条件与分析结果。</p>}
          </section>
        </div>
      </div>
      <footer className="synthesis-footer"><span>AI4S LAB · 结构 → 合成 → 表征 → 学习</span><MethodNote>相占比是当前参考模型的拟合贡献，不等于经标定的绝对质量纯度。上传谱保留样品与出处；演示谱保留来源标记。反馈继续按记录版本和晶胞几何身份绑定。</MethodNote></footer>
    </div>
  </dialog>;
}
