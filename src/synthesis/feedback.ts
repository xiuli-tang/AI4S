import type { Material } from "../types";
import { materialRecordKey } from "../materialContext";
import type { ReferenceBinding, SynthesisFeedback } from "./types";
import { sameReferenceBinding } from "./binding";

const digest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function feedbackRejectionReason(material: Material | undefined, reference: ReferenceBinding | undefined, demo: boolean): string | null {
  if (!material) return "请先关联当前数据集中的候选。";
  if (!reference || !digest(reference.structureHash) || reference.recordKey !== materialRecordKey(material)) return "参考结构缺少当前记录的身份绑定。";
  if (material.source === "mock") return demo && reference.kind === "demo" ? null : "Mock 候选仅接收演示反馈；上传谱请绑定真实数据库记录。";
  if (demo) return "演示谱不能回填真实候选，也不会改变其主动学习排序。";
  if (reference.kind === "derived") {
    const expected = material.validationStructure;
    if (!expected || !sameReferenceBinding(expected, reference) || !reference.derived
      || !digest(reference.derived.modelSha256) || reference.derived.parentStructureHash !== material.structureHash) return "构型验证方案未与当前材料和MACE运行匹配。";
  } else {
    if (reference.kind !== "record") return "导入或演示晶胞仅供谱图分析；回填真实候选需加载其对应的数据库晶胞。";
    if (!digest(material.structureHash) || reference.structureHash !== material.structureHash) return "参考几何哈希与当前数据记录不一致，请重新加载晶胞。";
  }
  const ref = material.structureRef, bound = reference.structureRef;
  if (!digest(material.recordRevision) || !ref || !bound || ref.id !== material.id || ref.revision !== material.recordRevision
    || ref.dataset !== bound.dataset || ref.id !== bound.id || ref.revision !== bound.revision) return "数据记录或参考结构版本未匹配，请重新加载并分析。";
  return null;
}
export function canApplySynthesisFeedback(material: Material, feedback: SynthesisFeedback): boolean {
  return !!feedback && feedback.schemaVersion === 2 && feedback.materialId === material.id
    && feedback.recordKey === materialRecordKey(material)
    && ["pass", "impurity"].includes(feedback.status) && typeof feedback.demo === "boolean"
    && [feedback.score, feedback.mainFraction].every(value => Number.isFinite(value) && value >= 0 && value <= 100)
    && Number.isFinite(feedback.prior) && feedback.prior >= 0.05 && feedback.prior <= 1
    && typeof feedback.sampleId === "string" && !!feedback.sampleId.trim()
    && typeof feedback.filename === "string" && !!feedback.filename.trim()
    && typeof feedback.createdAt === "string" && Number.isFinite(Date.parse(feedback.createdAt))
    && feedbackRejectionReason(material, feedback.reference, feedback.demo) === null;
}
export function feasibilityPrior(feedback?: SynthesisFeedback, material?: Material): number {
  return !feedback || material && !canApplySynthesisFeedback(material, feedback) || !Number.isFinite(feedback.prior)
    ? 1 : Math.max(.05, Math.min(1, feedback.prior));
}
export function feedbackLabel(feedback: SynthesisFeedback): string {
  return `${feedback.demo ? "演示谱" : "上传谱"}${feedback.status === "pass" ? "匹配通过" : "匹配不足"}`;
}
export function constrainAcquisition(score: number, prior: number): number {
  const factor = Number.isFinite(prior) ? Math.max(.05, Math.min(1, prior)) : 1;
  return score >= 0 ? score * factor : score / factor;
}
export function applySynthesisFeedback(pool: Material[], feedback: SynthesisFeedback): Material[] {
  return pool.map(material => {
    if (!canApplySynthesisFeedback(material, feedback)) return material;
    const oldPrior = feasibilityPrior(material.synthesisFeedback, material), value = material.acquisitionValue;
    const base = value === undefined ? undefined : value >= 0 ? value / oldPrior : value * oldPrior;
    return { ...material, synthesisFeedback: structuredClone(feedback),
      acquisitionValue: base === undefined ? undefined : constrainAcquisition(base, feasibilityPrior(feedback, material)) };
  });
}
const KEY = "ai4s-synthesis-feedback-v2";
export function loadFeedbackRegistry(): Record<string, SynthesisFeedback> {
  try {
    const input = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (!input || typeof input !== "object" || Array.isArray(input)) return {};
    return Object.fromEntries(Object.entries(input).filter(([key, value]) => {
      const feedback = value as SynthesisFeedback;
      return feedback?.schemaVersion === 2 && feedback.recordKey === key && digest(feedback.reference?.structureHash);
    }).map(([key, value]) => [key, value as SynthesisFeedback]));
  } catch { return {}; }
}
export function saveFeedbackRegistry(registry: Record<string, SynthesisFeedback>) {
  try { localStorage.setItem(KEY, JSON.stringify(registry)); } catch { /* Session feedback still works. */ }
}
export function restoreFeedback(pool: Material[], registry: Record<string, SynthesisFeedback>): Material[] {
  return Object.values(registry).reduce((current, feedback) => applySynthesisFeedback(current, feedback), pool);
}
