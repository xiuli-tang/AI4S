import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, X, Send, Square, Trash2, ChevronDown, FlaskConical, Cpu, MessageCircle } from "lucide-react";
import { advisorCandidates, advisorMessages, advisorQuestions, buildAdvisorContext, type AdvisorAction, type AdvisorContext, type AdvisorInput, type AdvisorLanguage } from "../services/AdvisorContext";
import { advisorErrorMessage, requestAdvisor } from "../services/AdvisorService";
import "./advisor.css";
import { sourceLabel } from "../dataHub";
import MethodNote from "./MethodNote";
import type { Restore, AdvisorArchive } from "../research/types";

export interface AdvisorRequest { requestId: number; materialId?: string; action?: AdvisorAction }
interface Props { open: boolean; onClose(): void; input: AdvisorInput; lang: AdvisorLanguage; loading: boolean; request: AdvisorRequest | null;
  restored?: Restore<AdvisorArchive>; onState?(state: AdvisorArchive): void; onSelect?(materialId: string | null): void; }
interface Turn {
  id: number; question: string; context: AdvisorContext; capturedAt: string;
  status: "pending" | "done" | "error" | "cancelled";
  answer?: string; error?: string; model?: string; tokens?: number; truncated?: boolean;
}

export default function MaterialsAdvisor({ open, onClose, input, lang, loading, request, restored, onState, onSelect }: Props) {
  const zh = lang === "zh";
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [compact, setCompact] = useState(false);
  const active = useRef<AbortController | null>(null);
  const serial = useRef(0);
  const handled = useRef(0);
  const latestReply = useRef<HTMLDivElement>(null);
  const scrolled = useRef("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const currentRun = useRef(input.runId);
  currentRun.current = input.runId;

  const cancel = () => {
    active.current?.abort(); active.current = null; setBusy(false);
    setTurns(previous => previous.map(turn => turn.status === "pending" ? { ...turn, status: "cancelled" } : turn));
  };
  const close = () => { cancel(); onClose(); };
  const restoredToken = useRef(0);

  useEffect(() => {
    active.current?.abort(); active.current = null;
    setBusy(false);
    if (restored && restoredToken.current !== restored.token) {
      const s = restored.value; restoredToken.current = restored.token;
      setTurns(s.turns.map(t => t.status === "pending" ? { ...t, status: "cancelled" } : t));
      serial.current = Math.max(0, ...s.turns.map(t => t.id)); setSelectedId(s.selectedId); setDraft(s.draft); setPreview(s.preview); setCompact(s.compact);
    } else { setTurns([]); setSelectedId(null); setDraft(""); setCompact(false); }
    handled.current = request?.requestId ?? 0;
  }, [input.runId, restored?.token]);
  useEffect(() => { onState?.({ turns, selectedId, draft, preview, compact }); }, [turns, selectedId, draft, preview, compact]);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  useEffect(() => {
    if (!open) { cancel(); return; }
    const previous = document.activeElement;
    textarea.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open]);
  useEffect(() => {
    const last = turns.at(-1);
    const key = last ? `${last.id}:${last.status}` : "";
    if (open && key && key !== scrolled.current) latestReply.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    scrolled.current = key;
  }, [turns, open]);

  async function send(question: string, materialId: string | null = selectedId) {
    if (!question.trim() || active.current || loading) return;
    if (materialId && !input.pool.some(m => m.id === materialId)) return;
    const context = buildAdvisorContext(input, materialId);
    const controller = new AbortController();
    const id = ++serial.current;
    active.current = controller; setBusy(true); setCompact(true);
    const turn: Turn = { id, question: question.trim(), context, capturedAt: new Date().toLocaleTimeString(), status: "pending" };
    const history = turns.filter(t => t.status === "done" && t.answer).map(t => ({ question: t.question, answer: t.answer!, iteration: t.context.learning.iteration }));
    setTurns(previous => [...previous, turn]);
    if (question.trim() === draft.trim()) setDraft("");
    try {
      const result = await requestAdvisor(advisorMessages(turn.question, context, history, lang), controller.signal);
      if (active.current !== controller || currentRun.current !== context.run_id) return;
      setTurns(previous => previous.map(t => t.id === id ? { ...t, ...result, status: "done" } : t));
    } catch (error) {
      if (active.current !== controller || currentRun.current !== context.run_id) return;
      setTurns(previous => previous.map(t => t.id === id ? {
        ...t, status: controller.signal.aborted ? "cancelled" : "error", error: advisorErrorMessage(error, lang),
      } : t));
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  }

  useEffect(() => {
    if (!open || loading || !request || request.requestId === handled.current) return;
    handled.current = request.requestId;
    cancel();
    setSelectedId(request.materialId ?? null);
    if (request.action) void send(advisorQuestions[request.action][lang], request.materialId ?? null);
  }, [open, request, loading]);

  if (!open) return null;
  const context = buildAdvisorContext(input, selectedId);
  const candidates = advisorCandidates(input.pool);
  const options = [...new Map([
    ...candidates, ...input.pool.filter(m => m.id === selectedId || m.id === context.best_observed_material?.id),
    ...(candidates.length ? [] : input.pool.slice(0, 12)),
  ].map(m => [m.id, m])).values()];
  const selected = context.selected_material;
  const actions: { action: AdvisorAction; label: string; icon: typeof Sparkles }[] = [
    { action: "integrated", label: zh ? "综合研究解读" : "Integrated research review", icon: Sparkles },
    { action: "overview", label: zh ? "复盘 Top-3" : "Review Top 3", icon: MessageCircle },
    { action: "mechanism", label: zh ? "选材解析" : "Why this?", icon: Sparkles },
    { action: "synthesis", label: zh ? "合成方案" : "Synthesis", icon: FlaskConical },
    { action: "dft", label: zh ? "DFT 方案" : "DFT plan", icon: Cpu },
  ];

  return <aside className="advisor-panel" role="dialog" aria-modal="false" aria-labelledby="advisor-title" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
    <header className="advisor-header">
      <div className="advisor-emblem"><Sparkles size={23} /></div>
      <div className="advisor-heading"><h2 id="advisor-title">{zh ? "AI 首席材料顾问" : "AI Materials Advisor"}</h2><p>DeepSeek Flash <span>·</span> {zh ? "与当前学习上下文连接" : "Connected to your learning context"}</p></div>
      <button type="button" className="advisor-icon" aria-label={zh ? "关闭 AI 顾问" : "Close AI advisor"} onClick={close}><X size={19} /></button>
    </header>

    <section className="advisor-context" aria-label={zh ? "当前分析上下文" : "Current analysis context"}>
      <div className="advisor-badges"><span className={input.isRealData ? "advisor-source-real" : "advisor-source-mock"}>{sourceLabel(context.dataset.source, lang)}</span><span>{zh ? "第" : "Round"} {input.state.iteration} {zh ? "轮" : ""}</span><span>{input.strategy} · {context.dataset.sampled}/{input.totalBudget}</span><button type="button" className="advisor-details-toggle" onClick={() => setCompact(!compact)} aria-expanded={!compact}>{compact ? (zh ? "展开上下文" : "Show context") : (zh ? "收起上下文" : "Hide context")}</button></div>
      {compact && selected && <p className="advisor-compact-selection">{selected.formula} · {selected.id} · µ {selected.prediction_mean_mu ?? "—"} · σ {selected.uncertainty_sigma ?? "—"}</p>}
      <div hidden={compact}>
      <label className="advisor-select-label" htmlFor="advisor-material">{zh ? "分析对象" : "Analyze"}</label>
      <select id="advisor-material" value={selectedId ?? ""} onChange={event => { const id = event.target.value || null; setSelectedId(id); onSelect?.(id); }} disabled={busy || loading}>
        <option value="">{zh ? "全局进展与 Top-3 候选" : "Overall progress & top candidates"}</option>
        {options.map(m => <option key={m.id} value={m.id}>{m.formula} · {m.id}{m.isSampled ? (zh ? " · 已采样" : " · sampled") : ""}</option>)}
      </select>
      {selected && <div className="advisor-selected-metrics"><span>µ {selected.prediction_mean_mu ?? "—"}</span><span>σ {selected.uncertainty_sigma ?? "—"}</span><span>{zh ? "成本" : "Cost"} {selected.cost.value ?? "—"}</span></div>}
      <button type="button" className="advisor-preview-toggle" onClick={() => setPreview(!preview)} aria-expanded={preview}><ChevronDown size={13} />{zh ? "查看将发送的数据摘要" : "Preview shared context"}</button>
      {preview && <div className="advisor-preview"><p>{zh ? "发送当前轮次、已采样最优材料、Top-3、选中材料的组成/特征/预测和近期收敛记录；不含未采样真实标签、密钥或结构文件。" : "Shares this round, the best sampled material, top candidates, selected composition/features/predictions and recent progress. No hidden candidate labels, keys or structure files."}</p><pre>{JSON.stringify(context, null, 2)}</pre></div>}
      <p className="advisor-evidence-note">{context.objective.name} / {context.objective.unit}</p>
      <MethodNote lang={lang}>{zh ? "来源、方法与保真度随快照保留；组成不能确定真实结构，成本为估计量。" : "The snapshot retains source, method and fidelity. Composition does not identify a crystal structure; costs are estimates."}</MethodNote>
      </div>
      <div className="advisor-actions">{actions.map(({ action, label, icon: Icon }) => <button type="button" key={action} disabled={busy || loading || (action !== "overview" && !selected)} onClick={() => { if (action === "overview") setSelectedId(null); void send(advisorQuestions[action][lang], action === "overview" ? null : selectedId); }}><Icon size={14} />{label}</button>)}</div>
    </section>

    <div className="advisor-conversation" aria-label={zh ? "顾问对话记录" : "Advisor conversation"}>
      {!turns.length && <div className="advisor-welcome"><div><Sparkles size={26} /></div><h3>{zh ? "让每个候选，都有下一步" : "Give every candidate a next step"}</h3><p>{zh ? "先运行一轮学习，再选择材料。我会结合预测、探索价值与成本解释推荐，并帮你起草可验证的研究方案。" : "Run a learning step and select a material. I can explain predictions, exploration value and cost, then draft a testable research plan."}</p><p className="advisor-welcome-hint">{zh ? "也可以直接提问：当前排名更偏向性能，还是探索？" : "Or ask: does this ranking favor performance or exploration?"}</p></div>}
      {turns.map(turn => <article key={turn.id} className="advisor-turn">
        <div className="advisor-user"><p>{turn.question}</p></div>
        <div ref={turn.id === turns.at(-1)?.id ? latestReply : undefined} className="advisor-turn-meta">{turn.capturedAt} · {zh ? "第" : "Round"} {turn.context.learning.iteration} {zh ? "轮快照" : "snapshot"} · {sourceLabel(turn.context.dataset.source, lang)}{turn.context.selected_material ? ` · ${turn.context.selected_material.formula}` : ""}</div>
        <div className="advisor-answer">
          {turn.status === "pending" && <div role="status" className="advisor-pending"><span />{zh ? "正在结合本轮数据分析…" : "Analyzing this snapshot…"}</div>}
          {turn.status === "cancelled" && <p className="advisor-muted">{zh ? "已停止本次分析。" : "Analysis stopped."}</p>}
          {turn.status === "error" && <div role="alert" className="advisor-error"><p>{turn.error}</p><button type="button" disabled={busy || loading} onClick={() => void send(turn.question, turn.context.selected_material?.id ?? null)}>{zh ? "按当前数据重试" : "Retry with current data"}</button></div>}
          {turn.answer && <><div className="advisor-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} components={{ a: ({ children, href }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>{turn.answer}</ReactMarkdown></div><div className="advisor-response-meta">{turn.model}{turn.tokens ? ` · ${turn.tokens} tokens` : ""}{turn.truncated ? (zh ? " · 回答达到长度上限，可追问继续" : " · Length limit reached; ask to continue") : ""}{input.state.iteration !== turn.context.learning.iteration ? (zh ? ` · 当前已到第 ${input.state.iteration} 轮` : ` · Current round ${input.state.iteration}`) : ""}</div></>}
        </div>
      </article>)}
    </div>

    <form className="advisor-composer" onSubmit={event => { event.preventDefault(); void send(draft); }}>
      <textarea ref={textarea} aria-label={zh ? "向材料顾问提问" : "Ask the materials advisor"} placeholder={zh ? "结合当前材料，问一个研究问题…" : "Ask about the current materials…"} value={draft} maxLength={2000} onChange={event => setDraft(event.target.value)} disabled={loading} rows={3} onKeyDown={event => {
        if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft); }
      }} />
      <div className="advisor-composer-bottom"><button type="button" className="advisor-clear" disabled={!turns.length} onClick={() => { cancel(); setTurns([]); setCompact(false); }}><Trash2 size={13} />{zh ? "清空会话" : "Clear"}</button><span>{draft.length}/2000</span>{busy ? <button type="button" className="advisor-send" onClick={cancel}><Square size={13} />{zh ? "停止" : "Stop"}</button> : <button type="submit" className="advisor-send" disabled={!draft.trim() || loading}><Send size={14} />{zh ? "发送" : "Send"}</button>}</div>
      <p>{zh ? "发送摘要与最近对话至已配置的模型服务；对话及当时的上下文可随研究存档保存。" : "Send the summary and recent conversation to your configured model service; save the conversation and captured context with your research archive."}</p>
    </form>
  </aside>;
}
