import { OBJECTIVES } from "../dataHub";
import { candidateReportSections, reportNotes, REPORT_QUESTIONS, reportCandidates, preferredReportCandidates, type MaterialReport } from "./report";
import type { CrystalStructure } from "../structures/types";

export const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function safeSourceUrl(value?: string) { try { const u = new URL(value!); return ["https:", "http:"].includes(u.protocol) ? u.href : ""; } catch { return ""; } }
export function structureSvg(s: CrystalStructure) {
  const project = (v: number[]) => {
    const xyz = [0, 1, 2].map(j => v.reduce((n, amount, i) => n + amount * s.lattice[i][j], 0));
    return [.8660254 * (xyz[0] - xyz[1]), .5 * (xyz[0] + xyz[1]) - xyz[2]];
  };
  const corners = Array.from({ length: 8 }, (_, i) => [i & 1, (i >> 1) & 1, (i >> 2) & 1]);
  const points = [...corners.map(project), ...s.sites.slice(0, 200).map(site => project(site.fractional))];
  const min = [0, 1].map(i => Math.min(...points.map(p => p[i]))), max = [0, 1].map(i => Math.max(...points.map(p => p[i])));
  const scale = Math.min(370 / Math.max(1e-9, max[0] - min[0]), 250 / Math.max(1e-9, max[1] - min[1]));
  const screen = (v: number[]) => project(v).map((n, i) => (i ? 165 : 225) + (n - (max[i] + min[i]) / 2) * scale);
  const edges = corners.flatMap((c, i) => [1, 2, 4].filter(bit => !(i & bit)).map(bit => {
    const a = screen(c), b = screen(corners[i | bit]);
    return '<path d="M' + a.map(v => v.toFixed(2)).join(",") + "L" + b.map(v => v.toFixed(2)).join(",") + '" fill="none" stroke="#87aaa5" stroke-width="2"/>';
  })).join("");
  const atoms = s.sites.slice(0, 200).map(site => {
    const [x, y] = screen(site.fractional), label = site.species.map(x => x.element).join("/");
    return '<g><circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="13" fill="' + (label === "O" ? "#db735e" : "#439d91") + '"/><text x="' + x.toFixed(2) + '" y="' + (y + 4).toFixed(2) + '" fill="white" text-anchor="middle" font-size="11">' + escapeHtml(label) + "</text></g>";
  });
  return '<svg viewBox="0 0 450 330" role="img" aria-label="Crystal structure projection">' + edges + atoms.join("") + "</svg>";
}
function curveSvg(report: MaterialReport) {
  const a = report.state.history.filter(x => Number.isFinite(x.bestValue)), r = report.state.comparison?.points ?? [];
  const values = [...a, ...r].map(x => x.bestValue), low = Math.min(...values), high = Math.max(...values), range = high - low || 1;
  const count = Math.max(1, report.state.sampledCount);
  const path = (points: { bestValue: number; sampledCount?: number; iteration?: number }[]) => points.map((p, i) =>
    (i ? "L" : "M") + (45 + 690 * (p.sampledCount ?? p.iteration ?? 0) / (p.sampledCount === undefined ? Math.max(1, report.state.iteration) : count)).toFixed(2)
    + "," + (210 - (p.bestValue - low) / range * 170).toFixed(2)).join(" ");
  return values.length ? '<svg viewBox="0 0 780 260" role="img" aria-label="AI and random comparison"><path d="M45 20V215H750" stroke="#849692" fill="none"/><path d="' + path(a) + '" fill="none" stroke="#0f766e" stroke-width="3"/><path d="' + path(r) + '" fill="none" stroke="#b45309" stroke-width="3" stroke-dasharray="7 4"/><text x="45" y="248" fill="#254a43">AI · ' + escapeHtml(OBJECTIVES[report.objective].unit) + ' / ' + (r.length ? "Random" : "Recorded rounds") + "</text></svg>" : "";
}
function spectrumSvg(points: { twoTheta: number; intensity: number }[], fitted: { twoTheta: number; intensity: number }[]) {
  if (!points.length) return "";
  const min = points[0].twoTheta, range = points.at(-1)!.twoTheta - min || 1;
  const max = Math.max(1, ...points.map(p => p.intensity), ...fitted.map(p => p.intensity));
  const path = (rows: typeof points) => rows.filter((_, i) => i % Math.max(1, Math.floor(rows.length / 1200)) === 0).map((p, i) =>
    (i ? "L" : "M") + (25 + 710 * (p.twoTheta - min) / range).toFixed(2) + "," + (200 - p.intensity / max * 175).toFixed(2)).join(" ");
  return '<svg viewBox="0 0 760 230" role="img" aria-label="XRD comparison"><path d="' + path(points) + '" fill="none" stroke="#b45309" stroke-width="2"/><path d="' + path(fitted) + '" fill="none" stroke="#0f766e" stroke-width="2" stroke-dasharray="5 3"/><text x="350" y="225">2θ / degrees</text></svg>';
}
export function reportHtml(report: MaterialReport, lang: "zh" | "en" = "zh") {
  const e = escapeHtml, t = (a: string, b: string) => lang === "zh" ? a : b, target = OBJECTIVES[report.objective];
  const selected = reportCandidates(report.candidates, report.objective), p = report.modules.pareto;
  const preference = preferredReportCandidates(report, p?.weights ?? [50, 25, 25]);
  const candidateHtml = selected.map((m, i) => '<article><h2>' + (i + 1) + ". " + e(m.formula) + " · " + e(m.id) + '</h2><p class="badge">' + t("已评价优选", "Evaluated shortlist") + '</p>' +
    candidateReportSections(m, report, lang).map((rows, k) => "<section><h3>" + REPORT_QUESTIONS[k][lang === "zh" ? 0 : 1] + "</h3>" + rows.map(r => /^(独立测试|Held-out test)/.test(r) ? "<details open><summary>" + t("方法与验证指标", "Method and validation metrics") + "</summary><p>" + e(r) + "</p></details>" : "<p>" + e(r) + "</p>").join("") + "</section>").join("") +
    "<details open><summary>" + t("来源与材料身份", "Source and identity") + "</summary><p>" + e(m.provenance?.reference) + "</p><p>" + e(m.recordKey) + "</p>" +
    (safeSourceUrl(m.provenance?.url) ? '<a href="' + e(safeSourceUrl(m.provenance?.url)) + '">' + t("原始来源", "Original source") + "</a>" : "") + "</details></article>").join("");
  const cases = report.cases.map(c => "<article><h2>" + e(c.label) + (c.example ? " · " + t("独立验证案例", "Separate validation example") : "") + "</h2>" + structureSvg(c.structure)
    + "<p>MACE: " + e(c.model ?? "—") + " · run " + e(c.runId ?? "—") + "</p><p>" + e(c.configuration?.result?.energyPerAtomEv ?? "—") + " eV/atom · Fmax " + e(c.configuration?.result?.maxForceEvAngstrom ?? "—") + " eV/Å</p>"
    + (c.xrd ? '<p class="badge">' + (c.xrd.demo ? t("合成演示谱", "Synthetic demonstration spectrum") : t("用户上传谱图", "User-uploaded spectrum")) + " · " + t("主相拟合", "Main-phase fit") + " " + e(c.xrd.comparison.mainFraction) + "%</p>" + spectrumSvg(c.xrd.comparison.observed, c.xrd.comparison.fitted) : "") + "</article>").join("");
  const answers = report.modules.advisor?.turns.filter(x => x.status === "done" && x.answer).map(x => "<section><h3>" + e(x.question) + "</h3><p>" + e(x.answer) + "</p></section>").join("") ?? "";
  return '<!doctype html><html lang="' + (lang === "zh" ? "zh-CN" : "en") + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + e(report.name) + ' · 问鼎储能</title><style>body{margin:0;background:#f3f5ef;color:#183c35;font:16px/1.75 system-ui,"PingFang SC",sans-serif}main{max-width:1100px;margin:auto;padding:35px}header,article,.summary{background:white;padding:28px;margin:20px 0;border:1px solid #d3e0d9;border-radius:16px}h1{font-size:32px}h2{font-size:24px}h3{font-size:18px}p{white-space:pre-wrap;overflow-wrap:anywhere}svg{width:100%;max-height:330px}button{padding:12px 20px;background:#185c4d;color:white;border:0;border-radius:8px;cursor:pointer}.badge{color:#684c0b}details{font-size:14px}table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left}@media print{body{background:white}main{padding:0}button{display:none}article{break-inside:avoid;border:0}details{display:block}section{break-inside:avoid}}</style></head><body><main><header><p>问鼎储能 · 问鼎·材料引擎</p><h1>' + e(report.name) + '</h1><p>' + (report.kind === "preset" ? t("预置示例报告", "Preset example report") : t("本次研究报告", "Current research report")) + " · " + e(report.savedAt) + '</p><button onclick="window.print()">' + t("打印 / 另存为 PDF", "Print / Save as PDF") + '</button></header><div class="summary"><h2>' + t("筛选进展", "Screening progress") + "</h2><p>" + report.candidates.length + t(" 个候选 → ", " candidates → ") + report.state.sampledCount + t(" 次评价 → ", " evaluations → ") + selected.length + t(" 个优选", " shortlisted") + " · " + target[lang] + " / " + target.unit + "</p>" + curveSvg(report) + "</div>" + candidateHtml +
    '<article><h2>' + t("性能、稳定性与成本取舍", "Performance, stability and cost") + '</h2><table><thead><tr><th>' + t("候选", "Candidate") + "</th><th>" + target[lang] + "</th><th>" + t("第二性质", "Second property") + "</th><th>USD/kg</th></tr></thead><tbody>" +
    preference.map(c => "<tr><td>" + e(c.formula) + "</td>" + c.objectives.map(v => "<td>" + e(Number(v.toPrecision(6))) + "</td>").join("") + "</tr>").join("") + "</tbody></table></article>" + cases +
    "<article><h2>" + t("研究解读与下一步", "Interpretation and next steps") + "</h2>" + (answers || "<p>" + t("可在研究工作台生成 AI 解读。", "Generate an interpretation in the research workspace.") + "</p>") + "</article><article><h2>" + t("数据与方法", "Data and methods") + "</h2>" +
    reportNotes(report, lang).map(n => "<p>" + e(n) + "</p>").join("") + "<p>" + e(report.metadata?.sourceVersion ?? report.metadata?.datasetVersion) + "</p><p>SHA256: " + e(report.metadata?.snapshotSha256 ?? "—") + "</p><p>" +
    t("已有计算标签用于回溯检验；公式为数据支持的解析关系；MACE 为固定晶胞构型弛豫。各项结果按其数据与计算来源解读。", "Existing computed labels support retrospective evaluation. Formulas are data-supported relations; MACE performs fixed-cell relaxation. Interpret each result with its recorded source.") + "</p></article></main></body></html>";
}
export function downloadReport(report: MaterialReport, lang: "zh" | "en") {
  const url = URL.createObjectURL(new Blob([reportHtml(report, lang)], { type: "text/html;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = "Wending-report-" + report.id.replace(/[^a-zA-Z0-9_-]/g, "_") + ".html"; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function printReport(report: MaterialReport, lang: "zh" | "en") {
  const frame = document.createElement("iframe"); frame.title = "Printable research report";
  frame.style.cssText = "position:fixed;width:1px;height:1px;left:-9999px;border:0";
  frame.srcdoc = reportHtml(report, lang);
  frame.onload = () => { frame.contentWindow?.addEventListener("afterprint", () => frame.remove(), { once: true }); frame.contentWindow?.focus(); frame.contentWindow?.print(); };
  document.body.append(frame); setTimeout(() => frame.remove(), 120000);
}
