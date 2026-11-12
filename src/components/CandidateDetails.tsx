import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import type { Material } from "../types";
import type { ResearchModules } from "../research/types";
import { safeReportMaterial, type MaterialReport } from "../research/report";
import { CandidateReportBody, type ReportAction } from "./ResearchReport";
export default function CandidateDetails({ material, modules, report, open, onClose, onAction }: {
  material: Material | null; modules: ResearchModules; report: MaterialReport; open: boolean; onClose(): void;
  onAction(action: ReportAction, material: Material): void;
}) {
  const { lang } = useI18n(), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open && !dialog.current?.open) dialog.current?.showModal(); else if (!open) dialog.current?.close(); }, [open]);
  return <dialog ref={dialog} className="research-dialog candidate-report-dialog" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><div><small>{lang === "zh" ? "问鼎·材料引擎 · 候选研究报告" : "WENDING · CANDIDATE REPORT"}</small><h2>{material?.formula ?? (lang === "zh" ? "候选报告" : "Candidate report")}</h2></div><button onClick={onClose}>{lang === "zh" ? "关闭" : "Close"}</button></header>
    {material && <div className="research-dialog-content"><p>{material.id} · {material.isSampled ? (lang === "zh" ? "已评价" : "Evaluated") : (lang === "zh" ? "下一步验证候选" : "Next evaluation candidate")}</p><CandidateReportBody material={safeReportMaterial(material)} report={{ ...report, modules }} onAction={action => onAction(action, material)} /></div>}
  </dialog>;
}
