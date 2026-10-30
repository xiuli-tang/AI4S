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
  const [name, setName] = useState("我的材料研究"), [history, setHistory] = useState<ResearchSession[]>([]), [working, setWorking] = useState(false), [message, setMessage] = useState("");
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => { void sessionHistory().then(setHistory).catch(() => {}); }, []);
  async function action(kind: "save" | "export" | "present") {
    if (busy || working) return; setWorking(true); setMessage("");
    try {
      const session = await capture(name.trim() || "材料研究");
      if (kind === "export") downloadResearch(session);
      else if (kind === "present") onPresent(session);
      else { await saveSession(session); setHistory(await sessionHistory()); setMessage("研究已保存，可刷新后从研究存档恢复。"); }
    } catch (e) { setMessage((e as Error).message); } finally { setWorking(false); }
  }
  async function restore(session: ResearchSession) {
    setWorking(true); setMessage("");
    try { await onRestore(session); setName(session.name); setMessage("研究已恢复，主动学习处于暂停状态。"); }
    catch (e) { setMessage((e as Error).message); } finally { setWorking(false); }
  }
  return <section className="research-controls" aria-label="统一研究会话">
    <div><span>RESEARCH WORKSPACE</span><h2>把本次研究完整带走</h2></div>
    <input aria-label="研究名称" value={name} onChange={e => setName(e.target.value)} maxLength={100} />
    <div className="research-action-row"><button disabled={busy || working} onClick={() => void action("save")}>保存研究</button><button disabled={busy || working} onClick={() => void action("export")}>导出研究存档</button><button disabled={busy || working} onClick={() => void action("present")}>展示本次研究</button><button disabled={working} onClick={() => file.current?.click()}>导入存档</button></div>
    <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e => {
      const selected = e.target.files?.[0]; if (!selected) return;
      setWorking(true); try {
        if (selected.size > 30 * 1024 * 1024) throw new Error("请导入30MB以内的研究存档。");
        const session = parseSession(JSON.parse(await selected.text())); await saveSession(session); setHistory(await sessionHistory()); setMessage("存档已导入，请选择恢复研究或展示成果。");
      } catch (e) { setMessage((e as Error).message); } finally { setWorking(false); }
      e.target.value = "";
    }} />
    <details><summary>研究存档（{history.length}）</summary><div className="research-session-list">{history.map(s => <article key={s.id}><div><b>{s.name}</b><small>{new Date(s.savedAt).toLocaleString()} · {s.state.sampledCount}条观测 · 第{s.state.iteration}轮</small></div><button disabled={working || busy} onClick={() => void restore(s)}>恢复研究</button><button disabled={working || busy} onClick={() => onPresent(s)}>成果路演</button><button onClick={() => downloadResearch(s)}>导出JSON</button></article>)}</div></details>
    {(working || message) && <p role="status">{working ? "正在整理研究记录…" : message}</p>}
  </section>;
}
