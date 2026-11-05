import { useI18n, userError } from "../i18n";
import { translateUI } from "../uiTranslations";
import { useEffect, useRef, useState } from "react";
import { saveSession, sessionHistory, parseSession } from "../research/session";
import type { ResearchSession } from "../research/types";

export function downloadResearch(session: ResearchSession) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `AI4S-research-${session.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ResearchControls({ capture, onRestore, onPresent, busy }: {
  capture(name: string): Promise<ResearchSession>; onRestore(session: ResearchSession): Promise<void>; onPresent(session: ResearchSession): void; busy: boolean;
}) {
  const { lang } = useI18n(); const tr = (text: string) => translateUI(text, lang);
  const [name, setName] = useState(""), [history, setHistory] = useState<ResearchSession[]>([]), [working, setWorking] = useState(false), [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void sessionHistory().then(setHistory).catch(() => setMessage(lang === "zh" ? "此浏览器暂时无法读取存档，请使用 JSON 导出备份。" : "Browser storage is unavailable. Export JSON to keep a backup.")); }, []);
  async function action(kind: "save" | "export" | "present") {
    if (busy || working) return; setWorking(true); setMessage("");
    try {
      const session = await capture(name.trim() || tr("材料研究"));
      if (kind === "export") downloadResearch(session);
      else if (kind === "present") onPresent(session);
      else { await saveSession(session); setHistory(await sessionHistory()); setMessage((lang === "zh" ? "已保存在当前浏览器。请导出 JSON 备份，方便换设备继续研究。" : "Saved in this browser. Export JSON for backup and use on another device.")); }
    } catch (e) { setMessage((e as Error).message); } finally { setWorking(false); }
  }
  async function restore(session: ResearchSession) {
    setWorking(true); setMessage("");
    try { await onRestore(session); setName(session.name); setMessage(tr("研究已恢复，主动学习处于暂停状态。")); }
    catch (e) { setMessage((e as Error).message); } finally { setWorking(false); }
  }
  return <section className="research-controls" aria-label={tr("统一研究会话")}>
    <div><span>RESEARCH WORKSPACE</span><h2>{tr("把本次研究完整带走")}</h2></div>
    <p className="research-storage-note">{lang === "zh" ? "保存位置：当前设备的当前浏览器。清除浏览器数据可能删除存档；换设备前请导出 JSON 文件。" : "Saved on this device in this browser. Clearing browser data can delete archives; export JSON before switching devices."}</p>
    <input aria-label={tr("研究名称")} placeholder={tr("我的材料研究")} value={name} onChange={e => setName(e.target.value)} maxLength={100} />
    <div className="research-action-row"><button disabled={busy || working} onClick={() => void action("save")}>{tr("保存研究")}</button><button disabled={busy || working} onClick={() => void action("export")}>{tr("导出研究存档")}</button><button disabled={busy || working} onClick={() => void action("present")}>{tr("展示本次研究")}</button><button disabled={working} onClick={() => file.current?.click()}>{tr("导入存档")}</button></div>
    <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e => {
      const selected = e.target.files?.[0]; if (!selected) return;
      setWorking(true); try {
        if (selected.size > 30 * 1024 * 1024) throw new Error(tr("请导入30MB以内的研究存档。"));
        const session = parseSession(JSON.parse(await selected.text())); await saveSession(session); setHistory(await sessionHistory()); setMessage(tr("存档已导入，请选择恢复研究或展示成果。"));
      } catch (e) { setMessage((e as Error).message); } finally { setWorking(false); }
      e.target.value = "";
    }} />
    <details><summary>{tr("研究存档（")}{history.length}{lang === "zh" ? "）" : ")"}</summary><div className="research-session-list">{history.map(s => <article key={s.id}><div><b>{s.name}</b><small>{new Date(s.savedAt).toLocaleString()} · {s.state.sampledCount}{tr("条观测 · 第")}{s.state.iteration}{tr("轮")}</small></div><button disabled={working || busy} onClick={() => void restore(s)}>{tr("恢复研究")}</button><button disabled={working || busy} onClick={() => onPresent(s)}>{tr("成果路演")}</button><button onClick={() => downloadResearch(s)}>{tr("导出JSON")}</button></article>)}</div></details>
    {(working || message) && <p role="status">{working ? tr("正在整理研究记录…") : userError(tr(message), lang)}</p>}
  </section>;
}
