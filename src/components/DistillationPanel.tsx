import { useEffect, useMemo, useState } from "react";
import { Atom, Download, FlaskConical, Play, Sparkles, Square, WandSparkles } from "lucide-react";
import type { Material } from "../types";
import type { DistillationController } from "../engine/distillation/useDistillation";
import type { DistillationResult, Metrics } from "../engine/distillation/types";
import { parseSupplements } from "../engine/distillation/features";
import { hashString } from "../engine/SeededRandom";
import { targetSpec, type TargetKind } from "../materialContext";
import "./distillation.css";
import MethodNote from "./MethodNote";

const number = (value: number | null | undefined, digits = 4) => value == null || !Number.isFinite(value) ? "—" : Number(value.toPrecision(digits)).toString();
const labels = (lang: "zh" | "en") => (zh: string, en: string) => lang === "zh" ? zh : en;

export function DistillationPanel({ controller: c, lang }: { controller: DistillationController; lang: "zh" | "en" }) {
  const t = labels(lang), result = c.result;
  const objective = result ? targetSpec(result.objective) : c.objective;
  const supplementText = c.supplementDraft, setSupplementText = c.setSupplementDraft;
  const [supplementError, setSupplementError] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  useEffect(() => { setSupplementError(null); }, [c.datasetIdentity]);
  const metricRows: { label: string; value: Metrics | undefined }[] = [
    { label: t("解析模型", "Symbolic model"), value: result?.metrics },
    { label: t("均值基线", "Mean baseline"), value: result?.meanBaseline },
    { label: "Ridge", value: result?.ridgeBaseline },
    { label: t("教师模型", "Teacher"), value: result?.teacherMetrics },
  ];
  const download = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "AI4S-formulas-" + result.snapshotId + ".json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="distillation-lab" aria-labelledby="distillation-heading">
    <header className="distillation-header">
      <div className="distillation-mark"><Atom size={26} /></div>
      <div className="distillation-heading">
        <p>WHITE-BOX DISCOVERY LAB</p>
        <h2 id="distillation-heading">{t("白盒物理公式蒸馏引擎", "Physical formula distillation")}</h2>
        <span>{t("算符组合 · L1 筛选 · L0 稀疏模型 · 组成分组验证", "Operator search · L1 screening · L0 models · composition-group validation")}</span>
      </div>
      <div className="distillation-actions">
        <button type="button" disabled={!result} onClick={download}><Download size={14} />{t("导出公式", "Export")}</button>
        {c.busy ? <button type="button" className="distillation-primary" onClick={c.cancel}><Square size={13} />{t("停止蒸馏", "Stop")}</button>
          : <button type="button" className="distillation-primary" disabled={!c.ready} onClick={() => void c.run()}><WandSparkles size={15} />{t("蒸馏物理公式", "Distill formulas")}</button>}
      </div>
    </header>
    <div className="distillation-controls">
      <label>{t("拟合目标", "Target")}
        <select aria-label={t("公式拟合目标", "Formula target")} value={c.target} disabled={c.busy} onChange={event => c.setTarget(event.target.value as typeof c.target)}>
          <option value="observed">{t("已采样性质 · 符号回归", "Sampled properties · symbolic regression")}</option>
          <option value="teacher">{t("教师预测均值 · 模型蒸馏", "Teacher means · distillation")}</option>
        </select>
      </label>
      <label>{t("自动触发门槛", "Sample threshold")}
        <select aria-label={t("公式采样门槛", "Formula threshold")} value={c.options.minSamples} disabled={c.busy}
          onChange={event => c.setOptions({ ...c.options, minSamples: Number(event.target.value) })}>
          {[20, 25, 30, 50].map(value => <option key={value} value={value}>{value} {t("条采样记录", "sampled records")}</option>)}
        </select>
      </label>
      <label className="distillation-auto"><input type="checkbox" checked={c.automatic} onChange={event => c.setAutomatic(event.target.checked)} />{t("达到门槛自动蒸馏", "Automatic search")}</label>
      <div className="distillation-count"><strong>{c.sampleCount}<small> / {c.options.minSamples}</small></strong><span>{c.groupCount} {t("个独立组成", "composition groups")}</span></div>
    </div>
    <div className="distillation-status" role="status">
      <span className={c.busy ? "distillation-pulse" : "distillation-dot"} />
      {c.busy ? t("正在后台搜索表达式、筛选稀疏模型并检验保留组…", "Searching expressions, sparse models and held-out groups in a Worker…")
        : c.error ? c.error : c.cancelled ? t("已停止自动蒸馏；可以手动重新计算。", "Automatic search stopped; you can run it again.")
          : result ? t("已生成候选解析模型", "Candidate analytic model ready") + " · " + result.evaluatedCandidates + t(" 个表达式已计算", " expressions evaluated")
            : !c.ready ? t("采样达到门槛且至少有 8 个独立组成后，将自动开始。", "Search starts after the threshold and at least eight composition groups.")
              : t("已满足搜索条件，可以开始蒸馏。", "Ready to distill.")}
    </div>
    {!result && <div className="distillation-waiting">
      <div className="distillation-formula-ghost">Φ₁ = f(χ, r, V, η)<span>Φ₂ = g(χ, r, V, η)</span></div>
      <div><h3>{t("从预测，走向可阅读的方程", "From predictions to readable equations")}</h3>
        <p>{t("使用真实的原始单位属性搜索 1–2 个解析描述符。公式、误差与适用样本会一起呈现。", "Search one or two descriptors from raw-unit properties, together with their errors and valid samples.")}</p>
        <p className="distillation-small">{t("M–O 键能与 uMLIP 几何量需要带单位和来源的补充数据。", "M–O energies and uMLIP geometry require supplemental units and provenance.")}</p></div>
    </div>}
    {result && <>
      <div className="distillation-result-meta">
        <span><Sparkles size={13} />{objective[lang]} / {objective.unit} · {objective.direction === "min" ? "↓ Minimize" : "↑ Maximize"}</span>
        <span>{t("快照", "Snapshot")} {result.snapshotId} · {t("第", "Round")} {result.iteration}{t("轮", "")} · {result.sampledRecords} {t("条", "records")}</span>
        <span>{number(result.searchMs / 1000, 3)} s</span>
      </div>
      <div className="distillation-formulas">{result.formulas.map((formula, index) => <article key={index}>
        <div className="distillation-formula-label"><span>Φ<sub>{index + 1}</sub></span><span>{formula.complexity} {t("个表达式节点", "nodes")}</span></div>
        <p className="distillation-equation">Φ<sub>{index + 1}</sub> = {formula.text}</p>
        <div className="distillation-term-meta"><span>{t("描述符单位", "Units")}: {formula.unit}</span><span>b<sub>{index + 1}</sub> = {number(formula.coefficient, 6)} [{objective.unit} / ({formula.unit})]</span></div>
      </article>)}</div>
      <div className="distillation-readout">ŷ = {number(result.intercept, 6)} {result.formulas.map((formula, i) => <span key={i}>{formula.coefficient >= 0 ? " + " : " − "}{number(Math.abs(formula.coefficient), 6)} Φ<sub>{i + 1}</sub></span>)} <small> {objective.unit}</small></div>
      <div className="distillation-validation">
        <div><h3><FlaskConical size={15} />{t("保留测试组检验", "Held-out composition groups")}</h3>
          <p>{t("发现 / 选择 / 测试组成数", "Discovery / tuning / test groups")}: {result.split.discovery.length} / {result.split.tuning.length} / {result.split.test.length}</p>
          <MethodNote lang={lang}>{t("本轮首次划分后固定组成归属；比较使用公式可计算的同一测试子集。", "Group membership is frozen per run; comparisons use the same formula-valid test subset.")}</MethodNote>
          {result.target === "teacher" && <p>{t("教师仅用发现组重训", "Teacher refitted on discovery groups")}: {result.teacherTrainingRecords} {t("条已采样标签", "sampled labels")} · {result.pseudoRecords} {t("条伪目标", "pseudo targets")}<br />{t("教师忠实度 RMSE", "Fidelity RMSE")}: {number(result.fidelity?.rmse)}</p>}
        </div>
        <table><thead><tr><th>{t("模型", "Model")}</th><th>MAE</th><th>RMSE</th><th>R²</th><th>{t("条/组", "N/G")}</th></tr></thead>
          <tbody>{metricRows.map(row => <tr key={row.label}><th>{row.label}</th><td>{number(row.value?.mae)}</td><td>{number(row.value?.rmse)}</td><td>{number(row.value?.r2)}</td><td>{row.value?.count}/{row.value?.groups}</td></tr>)}</tbody></table>
      </div>
      {result.metrics.invalid > 0 && <p className="distillation-evidence">{result.metrics.invalid + t(" 条测试记录超出公式定义域。", " test records fall outside the expression domain.")}</p>}
      <MethodNote lang={lang}>{t("这是当前样本支持的候选解析关系；小样本与主动采样偏差仍需前瞻性材料验证。描述符图展示特征投影，不给出热力学相边界。", "A candidate analytic relation supported by this snapshot. Small samples and adaptive sampling require prospective validation; the descriptor map does not establish thermodynamic phase boundaries.")}
        {result.axes.some(axis => axis.auxiliary) && " " + t("第二轴仅用于展示，未进入预测方程。", "The second axis is auxiliary and not used by the predictor.")}</MethodNote>
    </>}
    <details className="distillation-advanced" open={showDetails} onToggle={event => setShowDetails(event.currentTarget.open)}>
      <summary>{t("搜索参数与补充物理数据", "Search settings and supplemental physical data")}</summary>
      <div className="distillation-advanced-grid">
        <label>{t("搜索深度", "Search depth")}<select aria-label="Search depth" disabled={c.busy} value={c.options.maxDepth} onChange={event => c.setOptions({ ...c.options, maxDepth: Number(event.target.value) })}>{[2, 3, 4, 5].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>{t("表达式节点上限", "Node budget")}<select aria-label="Node budget" disabled={c.busy} value={c.options.maxNodes} onChange={event => c.setOptions({ ...c.options, maxNodes: Number(event.target.value) })}>{[5, 7, 9, 11, 15].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>{t("候选表达式上限", "Expression budget")}<select aria-label="Expression budget" disabled={c.busy} value={c.options.maxCandidates} onChange={event => c.setOptions({ ...c.options, maxCandidates: Number(event.target.value) })}>{[1500, 3000, 6000, 12000].map(value => <option key={value}>{value}</option>)}</select></label>
        <label>L1<input aria-label="L1" type="number" min="0" max="1" step="0.005" value={c.options.l1} disabled={c.busy} onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) c.setOptions({ ...c.options, l1: event.target.valueAsNumber }); }} /></label>
        <label>L0<input aria-label="L0" type="number" min="0" max="1" step="0.005" value={c.options.l0} disabled={c.busy} onChange={event => { if (Number.isFinite(event.target.valueAsNumber)) c.setOptions({ ...c.options, l0: event.target.valueAsNumber }); }} /></label>
      </div>
      <p className="distillation-small">{t("算符：+ − × ÷ |·| exp √。加减检查量纲，exp 要求无量纲；无定义、近零分母与溢出直接排除。既有容忍因子和缺值标志不进入搜索。", "Operators: + − × ÷ abs exp sqrt. Units and domains are checked. Existing tolerance factors and missing-data flags are excluded.")}</p>
      <label htmlFor="distillation-supplements">{t("补充物理量 JSON（按材料 ID）", "Supplemental physics JSON by material ID")}</label>
      <textarea id="distillation-supplements" rows={4} spellCheck={false} value={supplementText} onChange={event => setSupplementText(event.target.value)} disabled={c.busy}
        placeholder={'{"mp-...":{"bond_energy_mo":{"value":4.1,"unit":"eV","source":"数据来源","reference":"键解离能定义与参考态"}}}'} />
      <div className="distillation-supplement-actions"><button type="button" disabled={c.busy} onClick={() => {
        try { c.setSupplements(parseSupplements(supplementText, c.materialIds)); setSupplementError(null); }
        catch (error) { setSupplementError(error instanceof Error ? error.message : "Invalid JSON"); }
      }}>{t("应用补充数据", "Apply supplements")}</button><span>{Object.keys(c.supplements).length} {t("个材料已关联补充数据", "materials with supplements")}</span></div>
      {supplementError && <p role="alert" className="distillation-input-error">{supplementError}</p>}
      <p className="distillation-small">bond_energy_mo: eV · octahedral_distortion: 1 · volume_change_per_atom: Å³/atom · chi_A / chi_B: 1<br />{t("每项均需 value、unit、source、reference。几何量可来自 uMLIP/DFT 后处理；此模块不会自动执行 uMLIP。", "Each value requires unit, source and reference. Geometry may come from uMLIP/DFT postprocessing; this module does not run uMLIP.")}</p>
      {result && <div className="distillation-small">{t("未参与搜索的特征", "Excluded inputs")}: {result.excludedFeatures.map(feature => feature.id + " (" + feature.reason + ")").join("；")}</div>}
    </details>
  </section>;
}

type MapPoint = { id: string; formula: string; x: number; y: number; observed: number | null; prediction: number | null; partition: string };
function hull(points: [number, number][]): [number, number][] {
  const sorted = [...new Map(points.map(point => [point.join(","), point])).values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (sorted.length < 3) return [];
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (rows: [number, number][]) => { const output: [number, number][] = []; for (const p of rows) { while (output.length >= 2 && cross(output.at(-2)!, output.at(-1)!, p) <= 0) output.pop(); output.push(p); } return output; };
  const a = half(sorted), b = half([...sorted].reverse()); a.pop(); b.pop();
  return [...a, ...b];
}

export function DescriptorMap({ pool, result, lang, enabled, onToggle, objective = "band-gap", highlightedId }: {
  pool: Material[]; result: DistillationResult | null; lang: "zh" | "en"; enabled: boolean; onToggle(): void; objective?: TargetKind;
  highlightedId?: string;
}) {
  const t = labels(lang), symbolic = enabled && Boolean(result);
  const direction = targetSpec(symbolic && result ? result.objective : objective).direction;
  const [predictionColor, setPredictionColor] = useState(false);
  const [hovered, setHovered] = useState<MapPoint | null>(null);
  useEffect(() => setHovered(null), [pool, result, symbolic, predictionColor]);
  const points = useMemo<MapPoint[]>(() => {
    const rows = symbolic && result ? result.points : pool.filter(material =>
      Number.isFinite(material.descriptors?.statistics.electronegativityPauling.mean)
      && Number.isFinite(material.descriptors?.statistics.covalentRadiusAngstrom.mean)).map(material => ({
      id: material.id, formula: material.formula, x: material.descriptors!.statistics.electronegativityPauling.mean!,
      y: material.descriptors!.statistics.covalentRadiusAngstrom.mean!, observed: material.isSampled ? material.trueProperty : null,
      prediction: material.predictedMean ?? null, partition: "candidate",
    }));
    const sampled = rows.filter(row => row.observed !== null);
    const candidates = rows.filter(row => row.observed === null).sort((a, b) => hashString(a.id) - hashString(b.id));
    return [...candidates.slice(0, Math.max(0, 1800 - sampled.length)), ...sampled];
  }, [pool, result, symbolic]);
  const observed = points.filter(point => point.observed !== null).map(point => point.observed!).sort((a, b) => a - b);
  const threshold = symbolic && result ? result.highThreshold : observed[Math.floor((observed.length - 1) * (direction === "min" ? 0.2 : 0.8))] ?? (direction === "min" ? -Infinity : Infinity);
  const bounds = (values: number[]) => { const min = Math.min(...values), max = Math.max(...values); const pad = Math.max((max - min) * 0.08, Math.abs(min) * 0.02, 1e-6); return [min - pad, max + pad]; };
  const xBounds = points.length ? bounds(points.map(point => point.x)) : [0, 1];
  const yBounds = points.length ? bounds(points.map(point => point.y)) : [0, 1];
  const sx = (x: number) => 66 + (x - xBounds[0]) / (xBounds[1] - xBounds[0]) * 654;
  const sy = (y: number) => 264 - (y - yBounds[0]) / (yBounds[1] - yBounds[0]) * 234;
  const high = (point: MapPoint) => (predictionColor ? point.prediction : point.observed) !== null
    && (direction === "min" ? (predictionColor ? point.prediction! : point.observed!) <= threshold : (predictionColor ? point.prediction! : point.observed!) >= threshold);
  const island = symbolic ? hull(points.filter(high).map(point => [sx(point.x), sy(point.y)])) : [];
  const xLabel = symbolic && result ? "Φ₁ = " + result.axes[0].text : t("平均电负性 χ", "Mean electronegativity");
  const yLabel = symbolic && result ? result.axes[1] ? "Φ₂ = " + result.axes[1].text : t("单描述符（第二轴为 0）", "One descriptor (second axis = 0)") : t("平均共价半径 / Å", "Mean covalent radius / Å");
  const shorten = (text: string) => text.length > 60 ? text.slice(0, 57) + "…" : text;
  return <section className={"descriptor-map " + (symbolic ? "descriptor-map-symbolic" : "")} aria-label={t("描述符相图", "Descriptor Phase Map")}>
    <header><div><span>{symbolic ? "DESCRIPTOR PHASE MAP" : "COMPOSITION SPACE"}</span><h3>{symbolic ? t("AI 解析描述符相图", "Analytic descriptor map") : t("组成描述符投影", "Composition descriptor map")}</h3></div>
      <button type="button" disabled={!result} aria-pressed={symbolic} onClick={() => { setHovered(null); onToggle(); }}><Sparkles size={13} />{symbolic ? t("组成坐标", "Composition axes") : t("切换公式坐标", "Formula axes")}</button></header>
    <div className="descriptor-map-canvas">
      <svg viewBox="0 0 760 330" role="img" aria-label={symbolic ? xLabel + "；" + yLabel : t("组成统计量散点图", "Composition scatter plot")}>
        <defs><linearGradient id="descriptor-gold" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e8bd62" stopOpacity=".28" /><stop offset="1" stopColor="#e8bd62" stopOpacity=".04" /></linearGradient></defs>
        {[0, 1, 2, 3, 4].map(i => <g key={i}><line x1="66" x2="720" y1={30 + i * 58.5} y2={30 + i * 58.5} className="descriptor-grid" /><line x1={66 + i * 163.5} x2={66 + i * 163.5} y1="30" y2="264" className="descriptor-grid" /><text x="56" y={34 + i * 58.5} textAnchor="end">{number(yBounds[1] - i / 4 * (yBounds[1] - yBounds[0]), 3)}</text><text x={66 + i * 163.5} y="283" textAnchor="middle">{number(xBounds[0] + i / 4 * (xBounds[1] - xBounds[0]), 3)}</text></g>)}
        {island.length >= 3 && <polygon points={island.map(point => point.join(",")).join(" ")} fill="url(#descriptor-gold)" stroke="#cda35a" strokeDasharray="5 4" />}
        {points.map(point => <circle key={point.id} cx={sx(point.x)} cy={sy(point.y)} r={high(point) ? 4.8 : point.observed !== null ? 3.7 : 2.2}
          fill={high(point) ? "#dfb35c" : point.observed !== null ? "#4e9c85" : symbolic ? "#b4cbc3" : "#b1c7c4"}
          fillOpacity={high(point) || point.observed !== null ? 0.95 : 0.32}
          stroke={point.partition === "test" ? "#376fca" : high(point) ? "#fff1b7" : "none"} strokeWidth="1.6"
          className={(high(point) ? "descriptor-gold-point " : "") + (point.id === highlightedId ? "research-link-focus" : "")} tabIndex={point.observed !== null ? 0 : undefined}
          aria-label={point.formula + " · " + point.id} onMouseEnter={() => setHovered(point)} onFocus={() => setHovered(point)}>
          <title>{point.formula + " · " + point.id + "\n" + (point.observed !== null ? t("已采样", "Sampled") : t("未采样", "Unsampled"))}</title>
        </circle>)}
        <text x="393" y="316" textAnchor="middle" className="descriptor-axis-title"><title>{xLabel}</title>{shorten(xLabel)}</text>
        <text x="66" y="15" className="descriptor-axis-title"><title>{yLabel}</title>{shorten(yLabel)}</text>
      </svg>
      {hovered && <div className="descriptor-tooltip"><strong>{hovered.formula}</strong><span>{hovered.id}</span><span>Φ₁ / x: {number(hovered.x)} · Φ₂ / y: {number(hovered.y)}</span><span>{hovered.observed === null ? t("未采样，真实标签隐藏", "Unsampled; true label hidden") : t("已采样性质", "Observed") + ": " + number(hovered.observed)}</span><span>{t("预测", "Prediction")}: {number(hovered.prediction)}</span></div>}
    </div>
    <footer><div><i className="descriptor-legend-green" />{t("已采样", "Sampled")}<i className="descriptor-legend-gold" />{t("优选区间", "Preferred range")}{symbolic && <><i className="descriptor-legend-test" />{t("测试组", "Test groups")}</>}</div>
      <label><input type="checkbox" checked={predictionColor} onChange={event => setPredictionColor(event.target.checked)} />{t("按预测高亮", "Highlight predictions")}</label></footer>
    {symbolic && result ? <p className="descriptor-map-note">{predictionColor ? t("金色区域基于公式预测", "Gold region uses predictions") : t("金色区域按目标方向筛选观测点", "Gold region follows the objective direction")} · {t("第", "Round")} {result.iteration}{t("轮快照", " snapshot")} · {result.invalidProjection} {t("条候选缺值/越界", "missing/out-of-domain candidates")}</p>
      : <MethodNote lang={lang}>{t("公式生成后可一键切换。候选真实标签不参与着色。", "Switch axes once formulas are ready. Hidden candidate labels are not used for coloring.")}</MethodNote>}
  </section>;
}
