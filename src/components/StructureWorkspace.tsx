import React, { useEffect, useMemo, useRef, useState } from "react";
import StructureViewer, { elementColor } from "./StructureViewer";
import { displayAtoms, latticeParameters, MAX_STRUCTURE_SITES, minimumImageDistance, norm, structureComposition, subtract } from "../structures/geometry";
import { MAX_STRUCTURE_BYTES, type CrystalStructure } from "../structures/types";
import { exampleCif, examplePoscar } from "../structures/examples";
import { canViewMaterialStructure, type MaterialStructureRequest } from "../structures/materialStructure";
import { sourceLabel } from "../dataHub";
import { MaterialStructureService } from "../services/MaterialStructureService";
import { networkIssueCode, networkMessage } from "../services/NetworkStatus";
import "./structure.css";
import InlineXrd from "./InlineXrd";
import MethodNote from "./MethodNote";
import type { Restore } from "../research/types";

interface Props { open: boolean; onClose(): void; lang: "zh" | "en"; materialRequest?: MaterialStructureRequest | null; onImportMode?(): void; onOpenLab?(structure: CrystalStructure): void;
  restored?: Restore<CrystalStructure>; onStructure?(structure: CrystalStructure): void; onUseStructure?(structure: CrystalStructure, action: "queue" | "geometry"): void; }
type RemoteState = { requestId: number; status: "loading" | "ready" | "missing" | "error"; structure?: CrystalStructure; cached?: boolean; code?: string };
const formatNumber = (value: number, digits = 4) => value.toLocaleString("en-US", { maximumFractionDigits: digits, useGrouping: false });

export default function StructureWorkspace({ open, onClose, lang, materialRequest = null, onImportMode, onOpenLab, restored, onStructure, onUseStructure }: Props) {
  const t = (zh: string, en: string) => lang === "zh" ? zh : en;
  const dialog = useRef<HTMLDialogElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const version = useRef(0);
  const materialService = useRef(new MaterialStructureService());
  const [remote, setRemote] = useState<RemoteState | null>(null);
  const [retry, setRetry] = useState(0);
  const [structures, setStructures] = useState<CrystalStructure[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [paste, setPaste] = useState("");
  const [pasteFormat, setPasteFormat] = useState<"auto" | "cif" | "poscar">("auto");
  const [repeats, setRepeats] = useState(1);
  const [showCell, setShowCell] = useState(true);
  const [showNeighbors, setShowNeighbors] = useState(true);
  const [cutoff, setCutoff] = useState(2.5);
  const [selected, setSelected] = useState<number[]>([]);
  const [siteSearch, setSiteSearch] = useState("");
  const materialMode = materialRequest !== null;
  const currentRemote = remote?.requestId === materialRequest?.requestId ? remote : null;
  const structure = materialMode ? currentRemote?.status === "ready" ? currentRemote.structure : undefined : structures[activeIndex];
  const atoms = useMemo(() => structure ? displayAtoms(structure, repeats) : [], [structure, repeats]);
  const parameters = useMemo(() => structure ? latticeParameters(structure.lattice) : null, [structure]);
  const composition: Record<string, number> = useMemo(() => structure ? structureComposition(structure) : {}, [structure]);
  useEffect(() => {
    if (!restored) return;
    version.current++; cancelWorker(); setStructures([restored.value]); setActiveIndex(0); setRepeats(1); setSelected([]); setError(null); setBusy(false);
  }, [restored?.token]);
  useEffect(() => { if (structure && structure !== restored?.value) onStructure?.(structure); }, [structure]);

  function cancelWorker() {
    worker.current?.terminate(); worker.current = null;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }
  useEffect(() => {
    if (open && dialog.current && !dialog.current.open) dialog.current.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => () => { version.current++; cancelWorker(); }, []);
  useEffect(() => { setSelected([]); setSiteSearch(""); }, [structure, repeats]);
  useEffect(() => {
    if (!open || !materialRequest) return;
    const target = materialRequest;
    const controller = new AbortController();
    version.current++; cancelWorker(); setBusy(false); setError(null); setShowPaste(false);
    setRepeats(1); setSelected([]); setSiteSearch("");
    setRemote({ requestId: target.requestId, status: "loading" });
    void materialService.current.get(target, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setRemote(result.kind === "ready" ? { requestId: target.requestId, status: "ready", structure: result.structure, cached: result.cached }
        : { requestId: target.requestId, status: "missing" });
    }).catch(reason => {
      if (controller.signal.aborted) return;
      const code = reason?.response?.data?.code ?? reason?.code;
      setRemote({ requestId: target.requestId, status: code === "STRUCTURE_NOT_FOUND" ? "missing" : "error", code: typeof code === "string" ? code : "NETWORK_ERROR" });
    });
    return () => controller.abort();
  }, [open, materialRequest, retry]);

  async function load(input: File | string, filename: string, format: "auto" | "cif" | "poscar" = "auto") {
    const request = ++version.current;
    cancelWorker(); setBusy(true); setError(null);
    try {
      if (typeof input !== "string" && input.size > MAX_STRUCTURE_BYTES) throw new Error(t("文件超过 5 MB。", "File exceeds 5 MB."));
      const text = typeof input === "string" ? input : await input.text();
      if (request !== version.current) return;
      const nextWorker = new Worker(new URL("../structures/parse.worker.ts", import.meta.url), { type: "module" });
      worker.current = nextWorker;
      const fail = (message: string) => {
        if (request !== version.current) return;
        cancelWorker(); setBusy(false); setError(message);
      };
      timer.current = setTimeout(() => fail(t("解析超过 10 秒，已停止；请使用较小或简化后的结构文件。", "Parsing exceeded 10 seconds. Use a smaller or simplified structure file.")), 10000);
      nextWorker.onmessage = event => {
        if (request !== version.current) return;
        if (event.data.error) { fail(event.data.error); return; }
        cancelWorker(); setStructures(event.data.structures); setActiveIndex(0); setRepeats(1);
        setSelected([]); setSiteSearch(""); setBusy(false);
      };
      nextWorker.onerror = () => fail(t("结构解析器加载失败，请重试。", "The structure parser could not be loaded. Retry."));
      nextWorker.postMessage({ text, filename, format });
    } catch (reason) {
      if (request === version.current) {
        cancelWorker(); setBusy(false); setError(reason instanceof Error ? reason.message : t("无法读取文件。", "Cannot read the file."));
      }
    }
  }

  const selectAtom = (index: number) => setSelected(previous =>
    previous.includes(index) ? previous.filter(i => i !== index) : previous.length >= 2 ? [index] : [...previous, index]);
  let distance: { cartesian: number; periodic: number | null } | null = null;
  if (structure && selected.length === 2 && selected.every(index => atoms[index])) {
    const [a, b] = selected.map(index => atoms[index]);
    let periodic: number | null = null;
    try { periodic = minimumImageDistance(structure.sites[a.siteIndex].fractional, structure.sites[b.siteIndex].fractional, structure.lattice); } catch { /* pathological skew cells retain the displayed distance */ }
    distance = { cartesian: norm(subtract(a.position, b.position)), periodic };
  }
  const matchingSites = structure?.sites.map((site, index) => ({ site, index })).filter(({ site }) =>
    `${site.label} ${site.species.map(s => s.element).join(" ")}`.toLowerCase().includes(siteSearch.toLowerCase())) ?? [];

  return <dialog ref={dialog} className="structure-dialog" aria-labelledby="structure-title" onClose={onClose}
    onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header className="structure-header">
      <div><span className="structure-kicker">CRYSTAL STRUCTURES</span><h2 id="structure-title">{t("结构导入与 3D 查看", "Structure import & 3D viewer")}</h2>
        <p>{materialMode ? t("材料结构 · 按材料 ID 获取 · 晶胞与位点检查", "Material structures · retrieved by material ID · cell and site inspection") : t("CIF / POSCAR / CONTCAR · 本地解析 · 晶胞与位点检查", "CIF / POSCAR / CONTCAR · local parsing · cell and site inspection")}</p></div>
      <button type="button" className="structure-close" onClick={onClose} aria-label={t("关闭结构查看器", "Close structure viewer")}>×</button>
    </header>
    {materialMode ? <div className="structure-material-context" data-material-id={materialRequest.id}>
      <div><b>{materialRequest.formula} · {materialRequest.id}</b><p>{sourceLabel(materialRequest.structureRef?.dataset ?? materialRequest.source, lang)}
        {currentRemote?.status === "ready" && ` · ${currentRemote.cached ? t("已缓存", "Cached") : t("已从数据库获取", "Fetched from database")}`}</p></div>
      {onImportMode && <button type="button" onClick={onImportMode}>{t("打开本地结构导入", "Open local import")}</button>}
    </div> : <div className="structure-importbar" onDragOver={event => event.preventDefault()} onDrop={event => {
      event.preventDefault();
      const files = event.dataTransfer.files;
      if (files.length !== 1) { setError(t("请一次拖入一个结构文件。", "Drop one structure file at a time.")); return; }
      void load(files[0], files[0].name);
    }}>
      <input className="structure-file-input" ref={fileInput} type="file" aria-label={t("选择 CIF 或 POSCAR 文件", "Choose a CIF or POSCAR file")}
        onChange={event => { const file = event.target.files?.[0]; if (file) void load(file, file.name); event.target.value = ""; }} />
      <button type="button" className="structure-primary" onClick={() => fileInput.current?.click()}>{t("导入结构文件", "Import structure file")}</button>
      <span>{t("或拖入此处 · 最大 5 MB", "or drop here · up to 5 MB")}</span>
      <button type="button" onClick={() => setShowPaste(value => !value)} aria-expanded={showPaste}>{t("粘贴结构文本", "Paste structure text")}</button>
      <div className="structure-example-buttons"><span>{t("演示结构", "Examples")}</span>
        <button type="button" onClick={() => void load(examplePoscar, "SrTiO3_ideal_demo.POSCAR", "poscar")}>SrTiO₃</button>
        <button type="button" onClick={() => void load(exampleCif, "NaCl_demo.cif", "cif")}>NaCl</button></div>
    </div>}
    {!materialMode && showPaste && <div className="structure-paste">
      <label htmlFor="structure-paste-text">{t("结构文本", "Structure text")}</label>
      <textarea id="structure-paste-text" value={paste} onChange={event => setPaste(event.target.value)} rows={6} spellCheck={false} placeholder="data_... / POSCAR..." />
      <div><label>{t("格式", "Format")} <select value={pasteFormat} onChange={event => setPasteFormat(event.target.value as typeof pasteFormat)}><option value="auto">{t("自动识别", "Auto")}</option><option value="cif">CIF</option><option value="poscar">POSCAR</option></select></label>
        <button type="button" onClick={() => void load(paste, pasteFormat === "cif" ? "pasted.cif" : "pasted-structure", pasteFormat)} disabled={!paste.trim()}>{t("解析并显示", "Parse and display")}</button></div>
    </div>}
    {!materialMode && busy && <p className="structure-feedback" role="status">{t("正在本地解析结构…", "Parsing locally…")}</p>}
    {!materialMode && error && <p className="structure-feedback structure-error" role="alert">{error}{structure && <span> {t("保留上一份已成功导入的结构。", "The previous valid structure is retained.")}</span>}</p>}
    {materialMode && !structure && <div className="structure-empty" role={currentRemote?.status === "error" ? "alert" : "status"}>
      {!currentRemote || currentRemote.status === "loading" ? <><h3>{t("正在获取真实结构…", "Loading the database structure…")}</h3><p>{materialRequest.id}</p></>
        : currentRemote.status === "missing" ? <><h3>{t("暂无结构", "No structure available")}</h3><p>{materialRequest.source === "mock" ? t("该记录为 Mock 模拟材料，没有真实晶格和原子坐标。", "This Mock material has no real lattice or atomic coordinates.") : !canViewMaterialStructure(materialRequest) ? t("材料来源尚未确认，无法关联真实结构。", "The material source is unverified.") : t("数据库未提供该材料 ID 的结构。", "No structure was returned for this material ID.")}</p></>
        : <><h3>{t("结构获取失败", "Could not load the structure")}</h3><p>{currentRemote.code === "INVALID_REQUEST" ? t("材料 ID 无效。", "Invalid material ID.") : networkMessage(networkIssueCode(currentRemote.code === "ECONNABORTED" ? "TIMEOUT" : currentRemote.code), lang)}</p></>}
      {currentRemote && ["missing", "error"].includes(currentRemote.status) && canViewMaterialStructure(materialRequest) && <button type="button" onClick={() => setRetry(value => value + 1)}>{t("重试获取结构", "Retry structure request")}</button>}
    </div>}
    {!structure ? !materialMode && <div className="structure-empty">
      <div className="structure-empty-cell" aria-hidden="true">◇</div><h3>{t("从真实晶胞开始", "Start with a crystal structure")}</h3>
      <p>{t("导入文件或加载一个演示结构，查看原子、晶胞和位点距离。", "Import a file or load an example to inspect atoms, the unit cell and site distances.")}</p>
      <p className="structure-muted">{t("文件在浏览器本地读取，不上传到材料数据库或大模型。", "Files are read locally in your browser, without uploading to a database or language model.")}</p>
    </div> : <>
      <div className="structure-view-heading"><div><h3>{structure.name}</h3><p>{structure.source.filename} · {structure.source.providerLabel ?? (structure.source.format === "materials-project" ? "Materials Project" : structure.source.format.toUpperCase())}</p></div>
        {!materialMode && structures.length > 1 && <label>{t("CIF 数据块", "CIF block")} <select value={activeIndex} onChange={event => { setRepeats(1); setActiveIndex(Number(event.target.value)); }}>{structures.map((item, i) => <option key={i} value={i}>{item.name}</option>)}</select></label>}
        <span className="structure-unlabelled">{materialMode ? t("数据库材料对应结构", "Structure linked by material ID") : t("未关联目标性质标签", "No target-property label")}</span></div>
      {onUseStructure && <div className="structure-controls research-transfer-actions"><button type="button" onClick={() => onUseStructure(structure, "queue")}>加入 uMLIP 构型队列</button><button type="button" onClick={() => onUseStructure(structure, "geometry")}>几何量 → 白盒公式</button></div>}
      {structure.source.provenance && <details className="structure-feedback"><summary>{t("结构来源与版本", "Structure provenance and version")}</summary><p>{structure.source.provenance.reference}</p><p>{structure.source.provenance.datasetVersion} · {structure.source.fetchedAt}</p><a href={structure.source.provenance.url} target="_blank" rel="noopener noreferrer">{structure.source.provenance.url}</a></details>}
      <div className="structure-view-layout">
        <div className="structure-visual-area"><div className="structure-controls">
          <label><input type="checkbox" checked={showCell} onChange={event => setShowCell(event.target.checked)} />{t("晶胞", "Cell")}</label>
          <label><input type="checkbox" checked={showNeighbors} onChange={event => setShowNeighbors(event.target.checked)} disabled={atoms.length > 1200} />{t("几何邻接线", "Geometric links")}</label>
          <label>{t("截断", "Cutoff")} <input type="number" min="0.5" max="6" step="0.1" value={cutoff} onChange={event => setCutoff(Math.max(0.5, Math.min(6, Number(event.target.value) || 2.5)))} /> Å</label>
          <label>{t("显示超胞", "Display cell")} <select value={repeats} onChange={event => setRepeats(Number(event.target.value))}><option value={1}>1 × 1 × 1</option><option value={2} disabled={structure.sites.length * 8 > MAX_STRUCTURE_SITES}>2 × 2 × 2</option></select></label>
        </div>
          <StructureViewer structure={structure} atoms={atoms} repeats={repeats} showCell={showCell} showNeighbors={showNeighbors} cutoff={cutoff} selected={selected} active={open} onSelect={selectAtom} />
          {atoms.length > 1200 && <p className="structure-muted structure-geometry-note">{t("大结构已关闭邻接线以保持响应。", "Links are disabled for large structures.")}</p>}
          <MethodNote lang={lang}>{t("邻接线按当前显示原子的距离绘制；最多显示 8000 条。超胞为周期复制，原结构不变。几何邻接与化学键判定分别处理。", "Links use distances between displayed atoms, up to 8000. Supercells change the display only; geometric links and chemical bonds are distinct.")}</MethodNote>
          <InlineXrd structure={structure} active={open} onOpen={onOpenLab ? () => onOpenLab(structure) : undefined} />
        </div>
        <aside className="structure-info">
          <h4>{t("结构概况", "Structure summary")}</h4>
          <dl><div><dt>{t("元素组成（按占位）", "Composition by occupancy")}</dt><dd>{Object.entries(composition).map(([el, n]) => `${el}${formatNumber(n)}`).join(" ")}</dd></div>
            <div><dt>{t("当前晶胞结构位点", "Sites in imported cell")}</dt><dd>{structure.sites.length}</dd></div><div><dt>{t("当前显示位点", "Displayed sites")}</dt><dd>{atoms.length}</dd></div>
            <div><dt>{t("晶胞体积", "Cell volume")}</dt><dd>{formatNumber(parameters!.volume)} Å³</dd></div>
            <div><dt>a / b / c</dt><dd>{[parameters!.a, parameters!.b, parameters!.c].map(v => formatNumber(v)).join(" / ")} Å</dd></div>
            <div><dt>α / β / γ</dt><dd>{[parameters!.alpha, parameters!.beta, parameters!.gamma].map(v => formatNumber(v, 2)).join(" / ")}°</dd></div>
            <div><dt>{t("来源提供空间群", "Space group supplied by source")}</dt><dd>{structure.source.spaceGroup ?? t("未提供（未进行推断）", "Not supplied; not inferred")}</dd></div>
            {structure.source.fetchedAt && <div><dt>{t("结构获取时间", "Structure retrieved at")}</dt><dd>{new Date(structure.source.fetchedAt).toLocaleString(lang === "zh" ? "zh-CN" : "en-US")}</dd></div>}
            <div><dt>{t("坐标处理", "Coordinates")}</dt><dd>{structure.source.format === "materials-project" ? t("数据库完整晶胞，不再对称展开", "Full database cell; no extra symmetry expansion") : structure.source.format === "cif" && structure.source.symmetry === "expanded" ? t("显式对称操作已展开", "Explicit symmetry expanded") : t("按文件列出的位点", "Sites listed in file")}</dd></div></dl>
          <div className="structure-legend">{Object.keys(composition).map(el => <span key={el}><i style={{ background: elementColor(el) }} />{el}</span>)}</div>
          <h4>{t("已选位点 / 距离", "Selection / distance")}</h4>
          <div className="structure-selection" aria-live="polite">{selected.length === 0 ? <p>{t("点击模型中的原子或下方位点表；选择两个位点可测距。", "Select atoms in the model or table. Select two sites to measure distance.")}</p> : selected.map(index => {
            const atom = atoms[index]; if (!atom) return null;
            const site = structure.sites[atom.siteIndex];
            return <p key={index}><b>{site.label}</b> · #{atom.siteIndex + 1}<br />{site.species.map(s => `${s.element}: ${formatNumber(s.occupancy)}`).join(" / ")}<br />{t("平移", "Image")} [{atom.image.join(", ")}]</p>;
          })}
            {distance && <p><b>{t("显示距离", "Displayed distance")}: {formatNumber(distance.cartesian, 6)} Å</b><br />{t("最小周期距离", "Minimum periodic distance")}: {distance.periodic === null ? t("该晶胞超出搜索限制", "Cell exceeds search limit") : `${formatNumber(distance.periodic, 6)} Å`}</p>}
            {selected.length > 0 && <button type="button" onClick={() => setSelected([])}>{t("清除选择", "Clear selection")}</button>}</div>
        </aside>
      </div>
      {structure.source.warnings.length > 0 && <div className="structure-warnings" role="status"><b>{t("导入说明", "Import notes")}</b><ul>{structure.source.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
      <section className="structure-sites"><div className="structure-sites-heading"><h4>{t("位点与占位", "Sites and occupancy")}</h4><input type="search" aria-label={t("搜索结构位点", "Search structure sites")} placeholder={t("按标签或元素搜索", "Search label or element")} value={siteSearch} onChange={event => setSiteSearch(event.target.value)} /></div>
        <div className="structure-table-wrap"><table><thead><tr><th>#</th><th>{t("原始标签", "Source label")}</th><th>{t("元素 / 占位", "Species / occupancy")}</th><th>{t("分数坐标", "Fractional coordinates")}</th><th>{t("约束 T/F", "Selective T/F")}</th></tr></thead><tbody>{matchingSites.slice(0, 100).map(({ site, index }) => <tr key={site.id} className={selected.some(i => atoms[i]?.siteIndex === index) ? "is-selected" : ""}>
          <td>{index + 1}</td><td><button type="button" onClick={() => selectAtom(atoms.findIndex(atom => atom.siteIndex === index))}>{site.label}</button></td><td>{site.species.map(s => `${s.element} ${formatNumber(s.occupancy)}`).join(" / ")}</td><td>{site.fractional.map(v => formatNumber(v, 6)).join(", ")}</td><td>{site.selective ? site.selective.map(v => v ? "T" : "F").join(" ") : "—"}</td>
        </tr>)}</tbody></table></div><p className="structure-muted">{t(`匹配 ${matchingSites.length} 个位点，最多展示前 100 行。`, `${matchingSites.length} matching sites; first 100 rows shown.`)}</p></section>
    </>}
    <footer className="structure-footer"><MethodNote lang={lang}>{materialMode ? t("按材料 ID 查看对应的数据库结构；查看操作不改变训练数据、采样状态或目标性质。uMLIP 计算由独立入口执行。", "Structures are linked by material ID; viewing preserves learning state. uMLIP calculations use a separate workflow.") : t("导入结构与主动学习数据池独立保存；提供目标性质后可建立训练观测。演示文件保留理想结构来源。", "Imported structures are kept separately; target labels establish training observations. Examples retain their ideal-structure provenance.")}</MethodNote></footer>
  </dialog>;
}
