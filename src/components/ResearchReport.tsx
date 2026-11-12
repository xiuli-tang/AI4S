import { lazy, Suspense, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import { OBJECTIVES } from "../dataHub";
import { candidateReportSections, reportNotes, preferredReportCandidates, REPORT_QUESTIONS, reportCandidates, type MaterialReport, type ReportMaterial, type ValidationCase } from "../research/report";
import { downloadReport, printReport, safeSourceUrl } from "../research/reportHtml";
import { displayAtoms } from "../structures/geometry";
import type { Weights } from "../engine/pareto/ParetoEngine";
import ConvergenceChart from "./ConvergenceChart";
import XrdPlot from "./XrdPlot";
import "./structure.css";
import "./synthesis.css";
import "./workflow.css";
const Viewer = lazy(() => import("./StructureViewer"));
export type ReportAction = "structure" | "queue" | "xrd" | "advisor" | "formula" | "decision";

export function CandidateReportBody({ material, report, onAction }: { material: ReportMaterial; report: MaterialReport; onAction?(action: ReportAction): void }) {
  const { lang } = useI18n(), zh = lang === "zh";
  const sections = candidateReportSections(material, report, lang);
  const actions: ReportAction[] = ["structure", "formula", "decision", "queue", "xrd"];
  const labels = zh ? ["查看 3D 结构", "查看规律与验证", "调整研究偏好", "开展构型计算", "理论 / 实验 XRD"] : ["View crystal", "Review relation", "Research preferences", "Run relaxation", "Theory / experimental XRD"];
  return <div className="candidate-report-body">{sections.map((rows, i) => <section key={i}>
    <div className="report-question"><span>0{i + 1}</span><h3>{REPORT_QUESTIONS[i][zh ? 0 : 1]}</h3></div>
    {rows.filter(row => !/^(独立测试|Held-out test)/.test(row)).map((row, j) => <p key={j}>{row}</p>)}
    {rows.some(row => /^(独立测试|Held-out test)/.test(row)) && <details><summary>{zh ? "方法与验证指标" : "Method and validation metrics"}</summary>{rows.filter(row => /^(独立测试|Held-out test)/.test(row)).map(row => <p key={row}>{row}</p>)}</details>}
    {onAction && <button onClick={() => onAction(actions[i])}>{labels[i]} ↗</button>}
  </section>)}{onAction && <button className="workflow-primary" onClick={() => onAction("advisor")}>{zh ? "生成候选综合研究解读" : "Generate integrated interpretation"}</button>}
    <details><summary>{zh ? "来源与材料身份" : "Source and identity"}</summary><p>{material.provenance?.reference}</p><p>{material.provenance?.datasetVersion} · {material.provenance?.license}</p><p className="report-identity">{material.recordKey}</p>{safeSourceUrl(material.provenance?.url) && <a href={safeSourceUrl(material.provenance?.url)} target="_blank" rel="noreferrer">{zh ? "查看原始来源" : "Original source"} ↗</a>}</details>
  </div>;
}
function ValidationView({ item }: { item: ValidationCase }) {
  const { lang } = useI18n(), zh = lang === "zh";
  const atoms = useMemo(() => displayAtoms(item.structure, 1), [item.structure]);
  return <article className="workflow-card report-validation"><h3>{item.label}</h3>
    {item.example && <span className="workflow-badge">{zh ? "独立结构验证案例" : "Separate structure validation example"}</span>}
    <div className="research-snapshot-structure"><Suspense fallback={<p>{zh ? "正在加载晶胞…" : "Loading crystal…"}</p>}><Viewer structure={item.structure} atoms={atoms} repeats={1} showCell showNeighbors={false} cutoff={2.5} selected={[]} active onSelect={() => {}} /></Suspense></div>
    <p>{item.model} · {item.configuration?.status}</p><p>{item.configuration?.result?.energyPerAtomEv.toPrecision(7) ?? "—"} eV/atom · Fmax {item.configuration?.result?.maxForceEvAngstrom.toPrecision(4) ?? "—"} eV/Å</p>
    <details><summary>{zh ? "计算来源" : "Calculation source"}</summary><p>run {item.runId}</p><p className="report-identity">SHA256 {item.modelSha256}</p></details>
    {item.xrd ? <><span className="workflow-badge">{item.xrd.demo ? (zh ? "合成 XRD 演示谱" : "Synthetic XRD demonstration") : (zh ? "用户上传 XRD" : "User-uploaded XRD")}</span><p>{zh ? "主相拟合" : "Main-phase fit"} {item.xrd.comparison.mainFraction.toFixed(2)}%</p><XrdPlot pattern={item.xrd.reference.xrd.pattern} comparison={item.xrd.comparison} compact /></> : <p>{zh ? "该构型尚无绑定的谱图比对记录。" : "No spectrum comparison is bound to this configuration."}</p>}
  </article>;
}
export default function ResearchReport({ report, onExit }: { report: MaterialReport; onExit(): void }) {
  const { lang } = useI18n(), zh = lang === "zh", t = (a: string, b: string) => zh ? a : b;
  const shortlist = useMemo(() => reportCandidates(report.candidates, report.objective), [report]);
  const [selected, setSelected] = useState(shortlist[0]?.recordKey ?? ""), [tab, setTab] = useState("candidates");
  const [weights, setWeights] = useState<Weights>(report.modules.pareto?.weights ?? [50, 25, 25]);
  const candidate = report.candidates.find(c => c.recordKey === selected) ?? shortlist[0];
  const viewReport = report.modules.pareto ? { ...report, modules: { ...report.modules, pareto: { ...report.modules.pareto, weights } } } : report;
  const ranking = preferredReportCandidates(viewReport, weights), target = OBJECTIVES[report.objective];
  const answers = report.modules.advisor?.turns.filter(x => x.status === "done" && x.answer) ?? [];
  const tabs = [["candidates", t("候选报告", "Candidate reports")], ["decisions", t("值不值得做", "Decisions")], ["validation", t("结构与验证", "Structure & validation")], ["interpretation", t("解读与下一步", "Interpretation")], ["methods", t("数据与方法", "Data & methods")]];
  return <div className="workflow-report"><header className="workflow-header"><div><span className="workflow-eyebrow">{t("问鼎储能", "Wending Energy")}</span><h1>{t("问鼎·材料引擎", "Wending · Materials Engine")}</h1></div><div className="workflow-actions"><span className="workflow-badge">{report.kind === "preset" ? t("预置示例报告", "Preset example report") : t("本次研究报告", "Current research report")}</span><button onClick={() => downloadReport(viewReport, lang)}>{t("导出网页报告", "Export HTML report")}</button><button onClick={() => printReport(viewReport, lang)}>{t("打印 / PDF", "Print / PDF")}</button><button onClick={onExit}>{t("返回研究工作台", "Return to workspace")}</button></div></header>
    <div className="report-heading"><h2>{report.kind === "preset" ? t("材料筛选 · 完整示例报告", "Materials screening · example report") : report.name}</h2><p>{new Date(report.savedAt).toLocaleString()} · {target[lang]} / {target.unit} · {report.candidates.length} {t("候选", "candidates")} → {report.state.sampledCount} {t("评价", "evaluations")} → {shortlist.length} {t("优选", "shortlisted")}</p></div>
    <nav className="workflow-report-tabs">{tabs.map(([id, label]) => <button key={id} aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    <main>
      {tab === "candidates" && <div className="report-candidate-layout"><aside>{shortlist.map((m, i) => <button key={m.recordKey} aria-pressed={candidate?.recordKey === m.recordKey} onClick={() => setSelected(m.recordKey)}><small>TOP {i + 1} · {t("已评价优选", "Evaluated")}</small><b>{m.formula}</b><span>{m.observedValue?.toPrecision(6)} {target.unit}</span><small>{m.id}</small></button>)}</aside><article className="workflow-card">{candidate ? <><h2>{candidate.formula} · {t("候选材料报告", "Candidate report")}</h2><CandidateReportBody material={candidate} report={report} /></> : <p>{t("完成首轮评价后生成候选报告。", "Evaluate the first batch to create candidate reports.")}</p>}</article></div>}
      {tab === "decisions" && <div className="report-two-column"><article className="workflow-card"><ConvergenceChart state={{ ...report.state, bestValue: report.state.bestValue ?? NaN, history: report.state.history.map(h => ({ ...h, regret: 0, avgError: 0 })) }} direction={target.direction} unit={target.unit} strategy={report.session?.config.strategy ?? "UCB"} lang={lang} /></article><article className="workflow-card"><h2>{t("性能、稳定性与成本的取舍", "Performance, stability and cost")}</h2><div className="workflow-actions">{[[t("性能优先", "Performance"), [90, 7, 3]], [t("均衡优选", "Balanced"), [50, 25, 25]], [t("成本优先", "Cost"), [35, 15, 50]]].map(([label, w]) => <button key={String(label)} aria-pressed={JSON.stringify(weights) === JSON.stringify(w)} onClick={() => setWeights(w as Weights)}>{label as string}</button>)}</div><div className="workflow-table"><table><thead><tr><th>{t("候选", "Candidate")}</th><th>{target[lang]}</th><th>{report.modules.pareto?.problem?.axes[1][lang] ?? t("稳定性", "Stability")}</th><th>USD/kg</th></tr></thead><tbody>{ranking.map(c => <tr key={c.id}><td>{c.formula}</td>{c.objectives.map((v, i) => <td key={i}>{v.toPrecision(5)}</td>)}</tr>)}</tbody></table></div>{!ranking.length && <p>{t("完整的目标与价格记录可用后显示偏好排序。", "Preference ranking requires complete objective and price records.")}</p>}</article></div>}
      {tab === "validation" && <div className="report-two-column">{report.cases.map(c => <ValidationView key={c.id} item={c} />)}{!report.cases.length && <article className="workflow-card">{t("从候选报告查看结构，完成计算后在此汇总验证结果。", "Open a candidate structure and collect validation results here.")}</article>}</div>}
      {tab === "interpretation" && <article className="workflow-card"><h2>{t("综合研究解读", "Integrated interpretation")}</h2>{report.kind === "preset" && <span className="workflow-badge">{t("预置 AI 解读", "Preset AI interpretation")}</span>}{answers.map((a, i) => <section key={i}><h3>{a.question}</h3><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]}>{a.answer}</ReactMarkdown></section>)}{!answers.length && <p>{t("返回候选报告，生成综合研究解读与下一步方案。", "Return to a candidate to generate an interpretation and next-step plan.")}</p>}</article>}
      {tab === "methods" && <article className="workflow-card"><h2>{t("可追溯的研究证据", "Traceable research evidence")}</h2>{reportNotes(report, lang).map((n, i) => <p key={i}>{n}</p>)}<p>{report.metadata?.sourceVersion ?? report.metadata?.datasetVersion}</p><p className="report-identity">SHA256 {report.metadata?.snapshotSha256 ?? "—"}</p><p>{t("回溯验证按已揭示标签计数；白盒公式展示数据支持的关系；MACE 记录同成分固定晶胞弛豫；合成谱和上传谱分别标记。", "Retrospective evaluation counts revealed labels. Formulas express data-supported relations. MACE records same-composition fixed-cell relaxation. Synthetic and uploaded spectra are labelled separately.")}</p></article>}
    </main><footer>{t("问鼎储能 · 让每一次选材，都有完整的研究答案", "Wending Energy · A complete research answer for every material choice")}</footer>
  </div>;
}
