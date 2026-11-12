import { useEffect, useState } from "react";
import { useI18n } from "../i18n";
import { validatePresentationPreset } from "../demo/presentation";
import { presetReport, type MaterialReport } from "../research/report";
import ResearchReport from "./ResearchReport";
export default function PresentationWorkspace({ onExit }: { onExit(): void }) {
  const { lang } = useI18n();
  const [report, setReport] = useState<MaterialReport | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void import("../demo/presentation-preset.json").then(m => {
      const data = presetReport(validatePresentationPreset(m.default)); if (active) setReport(data);
    }).catch(() => { if (active) setError(lang === "zh" ? "示例报告暂不可用，请返回研究工作台。" : "The example report is unavailable. Return to the workspace."); });
    return () => { active = false; };
  }, []);
  return report ? <ResearchReport report={report} onExit={onExit} /> : <div className="workflow-loading"><p role="status">{error || (lang === "zh" ? "正在打开示例研究报告…" : "Opening example research report…")}</p><button onClick={onExit}>{lang === "zh" ? "返回研究工作台" : "Return to workspace"}</button></div>;
}
