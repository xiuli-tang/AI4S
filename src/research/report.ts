import type { Material, ALState } from "../types";
import { OBJECTIVES, type ObjectiveId, type HubMetadata } from "../dataHub";
import type { ResearchModules, ResearchSession, SavedCandidate } from "./types";
import type { PresentationPreset } from "../demo/types";
import type { CrystalStructure } from "../structures/types";
import type { ConfigurationRecord } from "../umlip/types";
import type { ExperimentRecord } from "../synthesis/types";
import { materialRecordKey } from "../materialContext";
import { configurationEvidence } from "./links";
import { asCrystalStructure } from "../umlip/configurations";
import { rankPreferredCandidates, type Weights } from "../engine/pareto/ParetoEngine";
import { PARETO_SCALES } from "../engine/pareto/ParetoData";

export type ReportMaterial = SavedCandidate & { observedProperties?: Material["objectiveValues"] };
export interface ValidationCase {
  id: string; label: string; recordKey?: string; structure: CrystalStructure;
  configuration?: ConfigurationRecord; runId?: string; model?: string; modelSha256?: string;
  xrd?: ExperimentRecord; example?: boolean;
}
export interface MaterialReport {
  id: string; name: string; savedAt: string; kind: "research" | "preset";
  objective: ObjectiveId; metadata: HubMetadata | null; candidates: ReportMaterial[];
  state: ResearchSession["state"]; modules: ResearchModules; cases: ValidationCase[];
  notes: string[]; session?: ResearchSession;
}
export function reportNotes(report: MaterialReport, lang: "zh" | "en") {
  if (lang === "zh") return report.notes;
  return report.kind === "preset" ? ["Archived Materials Project labels, separate SrTiO3 MACE calculation examples, a synthetic demonstration spectrum, and a preset AI interpretation."]
    : ["This saved research uses existing labels for retrospective evaluation. Calculation and spectrum sources are recorded separately."];
}
export const REPORT_QUESTIONS = [
  ["它好不好？", "How does it perform?"], ["为什么好？", "Why is it promising?"],
  ["值不值得做？", "Is it worth pursuing?"], ["结构稳不稳？", "How does the structure behave?"],
  ["做出来怎么确认？", "How can it be verified?"],
] as const;

export function reportCandidates(candidates: ReportMaterial[], objective: ObjectiveId, count = 3): ReportMaterial[] {
  const direction = OBJECTIVES[objective].direction;
  return candidates.filter(c => c.isSampled && Number.isFinite(c.observedValue) && c.synthesisFeedback?.status !== "impurity")
    .sort((a, b) => (direction === "min" ? a.observedValue! - b.observedValue! : b.observedValue! - a.observedValue!) || a.id.localeCompare(b.id)).slice(0, count);
}
export function safeReportMaterial(m: Material): ReportMaterial {
  const { trueProperty, objectiveValues, energyAboveHull, formationEnergyPerAtom, pairedDft, ...safe } = m;
  return { ...safe, recordKey: materialRecordKey(m), ...(m.isSampled ? { observedValue: trueProperty, observedProperties: objectiveValues ? { ...objectiveValues } : undefined } : {}) };
}
export function sessionReport(session: ResearchSession): MaterialReport {
  const m = session.modules, run = m.umlip?.run;
  const cases: ValidationCase[] = run?.candidates.filter(c => c.status === "converged" && c.result).map(c => {
    const linked = configurationEvidence(m, run.id, c.id);
    return { id: run.id + "/" + c.id, label: c.name, recordKey: c.origin?.recordKey,
      structure: linked.artifact?.structure ?? asCrystalStructure(c.result!.structure, c.name, c.source),
      configuration: c, runId: run.id, model: run.model?.label, modelSha256: run.model?.sha256, xrd: linked.xrd };
  }) ?? [];
  for (const a of m.structures) {
    if (cases.some(c => c.recordKey === a.recordKey && c.id === a.runId + "/" + a.candidateId)) continue;
    cases.push({ id: a.id, label: a.structure.name, recordKey: a.recordKey, structure: a.structure,
      runId: a.runId, modelSha256: a.modelSha256,
      xrd: m.experiments.find(e => {
        const ref = e.reference.binding;
        return ref?.structureHash === a.structureHash && ref.recordKey === a.recordKey
          && (a.stage !== "relaxed" || ref.kind === "derived" && ref.derived?.runId === a.runId && ref.derived?.candidateId === a.candidateId);
      }) });
  }
  return { id: session.id, name: session.name, savedAt: session.savedAt, kind: "research", objective: session.query.objective,
    metadata: session.metadata, candidates: session.candidates, state: session.state, modules: m, cases,
    notes: ["当前研究存档；性质评价采用已有数据库标签，结构计算与谱图来源逐项记录。"], session };
}
/** The preset retains its separate validation examples; absent material/run lineage is never invented. */
export function presetReport(p: PresentationPreset): MaterialReport {
  const modules: ResearchModules = { formula: { result: p.learning.formula, options: p.learning.formula.searchOptions,
    target: p.learning.formula.target, partitions: p.learning.formula.sourceSnapshot.partitions, supplements: {}, automatic: false, lastRequested: 0 },
    pareto: { mode: "materials-project", pool: p.pareto.pool.filter(c => c.observed), state: p.pareto.state, budget: p.pareto.budget,
      weights: p.pareto.weights, seed: p.pareto.seed, strategy: "ParEGO", prices: {}, externalStability: [], secondary: "auto", replay: null },
    advisor: { turns: [{ question: p.advisor.title, answer: p.advisor.answer, status: "done", capturedAt: p.advisor.generatedAt }],
      selectedId: null, draft: "", preview: false, compact: false }, umlip: null, experiments: [], structures: [], geometry: [], calibration: null, calibrationEnabled: false, stability: [] };
  const xrd: ExperimentRecord = { id: p.id + "-xrd", materialId: "preset-validation", formula: "SrTiO3", filename: p.xrd.filename,
    createdAt: p.createdAt, demo: true, temperature: 0, atmosphere: "未记录 / Not recorded", points: p.xrd.points,
    comparison: p.xrd.comparison, reference: { structure: p.xrd.structure, xrd: p.xrd.result, preflight: null } };
  const first = p.learning.pool.find(m => m.provenance);
  return { id: p.id, name: "固态材料筛选 · 示例研究报告", savedAt: p.createdAt, kind: "preset", objective: "band-gap",
    metadata: { requestedSource: "mp-snapshot", effectiveSource: "mp-snapshot", objective: "band-gap", total: p.learning.pool.length,
      datasetVersion: first?.provenance?.datasetVersion ?? "MP archive", fetchedAt: p.provenance.mpRetrievedAt, excludedMissingTarget: 0,
      query: { source: "mp-snapshot", objective: "band-gap", elements: "", excludeElements: "", cohort: "", match: "contains", limit: p.learning.pool.length } },
    candidates: p.learning.pool.map(safeReportMaterial), state: p.learning.state, modules,
    cases: p.umlip.candidates.map((c, i) => ({ id: p.umlip.sourceRunId + "/" + c.id, label: c.name, structure: c.crystal,
      configuration: c, runId: p.umlip.sourceRunId, model: p.umlip.model.label, modelSha256: p.umlip.model.sha256, example: true,
      ...(i === 0 ? { xrd } : {}) })),
    notes: [p.provenance.description, "MP 标签回溯档案；独立 SrTiO₃ 真实 MACE 计算案例；合成 XRD 演示谱；预置 AI 解读。", "基础提交 " + p.provenance.baseCommit + " · seed " + p.provenance.seed] };
}
export function preferredReportCandidates(report: MaterialReport, weights: Weights) {
  const p = report.modules.pareto;
  return p ? rankPreferredCandidates(p.pool.filter(c => c.observed && (c.observedAt ?? 0) <= (p.replay ?? p.state.round)), weights,
    PARETO_SCALES[p.mode], p.problem).slice(0, 5) : [];
}
export function candidateReportSections(material: ReportMaterial, report: MaterialReport, lang: "zh" | "en"): string[][] {
  const t = (zh: string, en: string) => lang === "zh" ? zh : en, n = (v?: number | null) => Number.isFinite(v) ? Number(v!.toPrecision(6)).toString() : "—";
  const target = OBJECTIVES[report.objective], f = report.modules.formula?.result;
  const q = f?.sourceSnapshot.queries.find(q => q.lineage?.recordKey === material.recordKey);
  const point = q ? f?.points.find(p => p.id === q.id) : undefined;
  const p = report.modules.pareto, tradeoff = p?.pool.find(c => c.observed && c.lineage?.recordKey === material.recordKey);
  const cases = report.cases.filter(c => c.recordKey === material.recordKey);
  const spectra = report.modules.experiments.filter(e => e.reference.binding?.recordKey === material.recordKey);
  const answers = report.modules.advisor?.turns.filter(turn => turn.status === "done" && turn.context?.selected_material?.record_key === material.recordKey && turn.answer) ?? [];
  const equation = f ? "ŷ = " + n(f.intercept) + f.formulas.map((x, i) => " " + (x.coefficient < 0 ? "− " : "+ ") + n(Math.abs(x.coefficient)) + " Φ" + (i + 1)).join("") + " " + target.unit : "";
  return [
    [target[lang] + ": " + (material.isSampled ? n(material.observedValue) + " " + target.unit : t("待验证", "Pending evaluation")),
      (material.isSampled ? t("采样前预测", "Prediction before evaluation") : t("模型预测", "Model prediction")) + " μ = " + n(material.predictedMean) + " · σ = " + n(material.predictedStd)],
    f ? [equation, ...f.formulas.map((x, i) => "Φ" + (i + 1) + " = " + x.text),
      t("公式解读：", "Interpretation: ") + f.formulas.map((x, i) => "Φ" + (i + 1) + t(" 增大对应预测" + target.zh + (x.coefficient >= 0 ? "上升" : "下降"), " increases correspond to " + (x.coefficient >= 0 ? "higher" : "lower") + " predicted " + target.en.toLowerCase())).join(t("；", "; ")),
      t("独立测试", "Held-out test") + " MAE " + n(f.metrics.mae) + " · R² " + n(f.metrics.r2),
      point ? t("当前材料的解析预测", "Analytical prediction for this material") + ": " + n(point.prediction) + " " + target.unit
        : t("当前研究的整体解析规律；该材料尚无独立公式投影。", "Study-wide analytical relation; no separate projection for this candidate.")]
      : [t("评价更多候选后生成可解释规律。", "Evaluate more candidates to fit an interpretable relation.")],
    tradeoff ? [t("性能 / 第二性质 / 原料参考价", "Performance / second property / reference material price") + ": " + tradeoff.objectives.map(n).join(" / "),
      (p?.problem?.axes.map(a => a[lang] + " / " + a.unit).join(" · ") ?? target.unit + " · eV/atom · USD/kg"),
      t("价格口径", "Price basis") + ": " + (tradeoff.priceQuality === "reference" ? t("公开参考价", "Public reference") : t("企业情景报价", "Editable procurement scenario"))]
      : [t("随已评价材料同步性能与稳定性，完整价格数据可用后加入多目标偏好排序。", "Synchronize evaluated performance and stability; add preference ranking when price coverage is available."),
        t("凸包上能量", "Energy above hull") + ": " + n(material.observedProperties?.["energy-above-hull"]) + " eV/atom"],
    cases.length ? cases.map(c => c.label + ": " + (c.configuration?.status ?? t("已关联结构", "Linked structure")) + " · " + n(c.configuration?.result?.energyPerAtomEv) + " eV/atom · Fmax " + n(c.configuration?.result?.maxForceEvAngstrom) + " eV/Å")
      : [t("可查看原始晶体结构，并加入同成分构型计算。", "Inspect the source crystal and start same-composition calculations.")],
    [...(spectra.length ? spectra.map(e => (e.demo ? t("合成演示谱", "Synthetic demonstration") : t("上传谱图", "Uploaded spectrum")) + " · " + e.filename + " · " + t("主相拟合", "Main-phase fit") + " " + n(e.comparison.mainFraction) + "%")
      : [t("计算理论 XRD，与实验谱比对；结合合成预审制定下一步验证方案。", "Compute theoretical XRD, compare an experimental pattern, and plan validation with synthesis preflight.")]),
      ...answers.slice(-1).map(a => a.answer)]
  ];
}
