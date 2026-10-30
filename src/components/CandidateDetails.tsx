import { useEffect, useRef } from "react";
import type { Material } from "../types";
import type { ResearchModules } from "../research/types";
import { materialRecordKey, targetSpec } from "../materialContext";
import { canViewMaterialStructure } from "../structures/materialStructure";

export default function CandidateDetails({ material, modules, open, onClose, onAction }: {
  material: Material | null; modules: ResearchModules; open: boolean; onClose(): void;
  onAction(action: "structure" | "queue" | "xrd" | "advisor" | "formula", material: Material): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  const key = material ? materialRecordKey(material) : "";
  const structures = modules.structures.filter(a => a.recordKey === key), records = modules.experiments.filter(r => r.reference.binding?.recordKey === key);
  const formula = modules.formula?.result, point = formula?.sourceSnapshot.queries.some(q => q.lineage?.recordKey === key) ? formula.points.find(p => p.id === material?.id) : undefined;
  const target = targetSpec(material?.targetKind ?? "band-gap");
  return <dialog ref={dialog} className="research-dialog" onCancel={e => { e.preventDefault(); onClose(); }}><header><div><small>CONNECTED MATERIAL RECORD</small><h2>{material?.formula ?? "候选详情"}</h2></div><button onClick={onClose}>关闭</button></header><div className="research-dialog-content">{material && <>
    <p>{material.id} · {material.source} · {material.fidelity} · {material.recordRevision?.slice(0, 12)}</p>
    <div className="research-detail-metrics"><div><span>{target.zh} / {target.unit}</span><b>{material.isSampled ? material.trueProperty.toFixed(4) : "待评价"}</b></div><div><span>模型 μ / σ</span><b>{material.predictedMean?.toFixed(3) ?? "—"} / {material.predictedStd?.toFixed(3) ?? "—"}</b></div><div><span>关联结构 / XRD</span><b>{structures.length} / {records.length}</b></div></div>
    <div className="research-action-row">{([["structure", "查看 3D 结构"], ["queue", "加入 uMLIP 队列"], ["xrd", "合成 / XRD"], ["formula", "定位公式与描述符"], ["advisor", "AI 综合解析"]] as const).map(([action, label]) => <button key={action} disabled={(action === "structure" || action === "queue") && !canViewMaterialStructure(material)} onClick={() => onAction(action, material)}>{label}</button>)}</div>
    {point && <section><h3>白盒解释</h3><p>Φ₁ {point.x.toPrecision(5)} · Φ₂ {point.y.toPrecision(5)} · 解析预测 {point.prediction.toPrecision(5)} {target.unit}</p></section>}
    <section><h3>当前目标与辅助性质</h3><table><tbody>{Object.entries(material.objectiveValues ?? {}).map(([id, value]) => <tr key={id}><th>{id}</th><td>{material.isSampled ? `${value} ${material.objectiveUnits?.[id] ?? ""}` : "评价后可见"}</td></tr>)}</tbody></table></section>
    {structures.length > 0 && <section><h3>结构与计算链</h3>{structures.map(a => <p key={a.id}>{a.stage} · {a.structure.name} · {a.structureHash.slice(0, 12)} {a.runId ? `· run ${a.runId.slice(0, 8)}` : ""}</p>)}</section>}
    {records.length > 0 && <section><h3>谱图记录</h3>{records.map(r => <p key={r.id}>{r.filename} · {r.comparison.score}/100 · 主相拟合 {r.comparison.mainFraction}%</p>)}</section>}
    <details><summary>来源与材料身份</summary><p>{material.provenance?.reference}</p><p>{material.methodMeta} · {material.cohort}</p><pre>{key}</pre></details>
  </>}</div></dialog>;
}
