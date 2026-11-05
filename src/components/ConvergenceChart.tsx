import { useEffect, useRef, useState } from "react";
import type { ALState } from "../types";
import { comparisonSavings } from "../engine/RandomComparison";
import type { ObjectiveDirection } from "../dataHub";

export default function ConvergenceChart({ state, strategy, direction, unit, lang }: { state: ALState; strategy: string; direction: ObjectiveDirection; unit: string; lang: "zh" | "en" }) {
  const host = useRef<HTMLDivElement>(null), [width, setWidth] = useState(360);
  const t = (zh: string, en: string) => lang === "zh" ? zh : en;
  const strategyName = strategy === "Random" ? t("成本加权随机", "Cost-aware random") : `${t("主动学习", "Active learning")} · ${strategy}`;
  useEffect(() => {
    const observer = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w > 0) setWidth(Math.max(260, w)); });
    if (host.current) observer.observe(host.current); return () => observer.disconnect();
  }, []);
  const active = state.history.filter(p => p.sampledCount !== undefined);
  const random = state.comparison?.points ?? [], values = [...active, ...random].map(p => p.bestValue).filter(Number.isFinite);
  const min = values.length ? Math.min(...values) : 0, max = values.length ? Math.max(...values) : 1;
  const pad = Math.max((max - min) * .12, Math.abs(max) * .01, .01), low = min - pad, high = max + pad;
  const count = Math.max(state.sampledCount, 1), left = 58, right = width - 18, top = 18, bottom = 208;
  const x = (n: number) => left + n / count * (right - left), y = (v: number) => bottom - (v - low) / (high - low) * (bottom - top);
  const path = (points: { sampledCount?: number; bestValue: number }[]) => points.map((p, i) => `${i ? "L" : "M"}${x(p.sampledCount!).toFixed(2)},${y(p.bestValue).toFixed(2)}`).join(" ");
  const savings = comparisonSavings(state, direction);
  return <section id="learning-results" className="learning-comparison" aria-labelledby="comparison-title">
    <h3 id="comparison-title">{t("采样效率 · 与随机对照", "Sampling efficiency · random comparison")}</h3>
    <p>{t("最佳已观测值", "Best observed value")} / {unit} · {direction === "min" ? t("越低越好", "Lower is better") : t("越高越好", "Higher is better")}</p>
    <div ref={host} className="comparison-chart">
      <svg width="100%" height="250" viewBox={`0 0 ${width} 250`} role="img" aria-label={t("主动学习与随机采样最佳值曲线，横轴为已评价候选数", "Best values for active and random sampling by evaluation count")}>
        {[0, 1, 2, 3].map(i => { const value = low + (high - low) * i / 3; return <g key={i}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#cbd5e1" strokeDasharray="4 4"/><text x={left - 7} y={y(value) + 4} textAnchor="end" fontSize="12" fill="#475569">{value.toFixed(2)}</text></g>; })}
        {[0, Math.round(count / 2), count].filter((n, i, all) => all.indexOf(n) === i).map(n => <text key={n} x={x(n)} y={228} textAnchor="middle" fontSize="12" fill="#475569">{n}</text>)}
        <path d={path(random)} fill="none" stroke="#b45309" strokeWidth="2.5" strokeDasharray="6 4"/>
        <path d={path(active)} fill="none" stroke="#0f766e" strokeWidth="3"/>
        {active.map(p => <circle key={p.iteration} cx={x(p.sampledCount!)} cy={y(p.bestValue)} r="3" fill="#0f766e"><title>{p.sampledCount}: {p.bestValue.toFixed(4)} {unit}</title></circle>)}
      </svg>
    </div>
    <div className="comparison-legend"><span>● {strategyName}</span><span>┄ {t("均匀随机", "Uniform random")}</span><span>{t("横轴：评价候选数", "X: evaluated candidates")}</span></div>
    {!active.length ? <p role="status">{t("运行首轮后，显示同一初始样本、相同评价数的对照。", "Run the first round to compare equal evaluation counts from shared initial samples.")}</p>
      : <p className="comparison-result">{savings?.saved != null ? t(`达到本轮最佳值：${strategyName} ${savings.active} 次，均匀随机 ${savings.random} 次；${savings.saved >= 0 ? "少" : "多"}评价 ${Math.abs(savings.saved)} 个候选。`,
        `Reaching this result: ${strategyName} ${savings.active}, uniform random ${savings.random}; ${Math.abs(savings.saved)} ${savings.saved >= 0 ? "fewer" : "more"} evaluations.`)
        : t(`随机对照在相同的 ${state.sampledCount} 次评价内尚未达到本轮最佳值，暂不计算节省次数。`, `Random has not reached this result within ${state.sampledCount} evaluations; savings are not yet available.`)}</p>}
    <details><summary>{t("对照方法与记录", "Comparison method & records")}</summary><p>{t("已有标签回放；固定种子、同一候选池和初始观测，无放回等概率采样。曲线按实际批次评价数对齐。节省次数为达到本轮结果的事后比较，允许随机策略胜出。", "Existing-label replay with a fixed seed, shared pool and initial observations, uniform sampling without replacement. Curves align at actual batch counts. Savings are a post-hoc comparison to this result; random can win.")}</p><p>{t("随机种子", "Random seed")}: {state.comparison?.seed ?? "—"}</p></details>
  </section>;
}
