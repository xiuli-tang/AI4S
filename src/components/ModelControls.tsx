import React, { useEffect, useState } from "react";
import { MODEL_CATALOG, type ModelConfig } from "../engine/models/config";
import type { ModelDiagnostics } from "../engine/SurrogateModel";
import MethodNote from "./MethodNote";

interface Props {
  config: ModelConfig;
  onChange(config: ModelConfig): void;
  locked: boolean;
  busy: boolean;
  diagnostics?: ModelDiagnostics;
  lang: "zh" | "en";
}

function NumberSetting({ label, value, min, max, step, onCommit }: {
  label: string; value: number; min: number; max: number; step: number; onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setDraft(String(value)); setInvalid(false); }, [value]);
  const commit = () => {
    const parsed = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max && (step < 1 || Number.isInteger(parsed))) {
      setInvalid(false);
      if (parsed !== value) onCommit(parsed);
    } else { setInvalid(true); setDraft(String(value)); }
  };
  return <label className="block text-xs space-y-1">
    <span>{label}</span>
    <input aria-label={label} aria-invalid={invalid} type="number" min={min} max={max} step="any" value={draft}
      className="w-full rounded-lg border border-gray-200 bg-gray-50 p-2 disabled:opacity-50"
      onChange={event => { setDraft(event.target.value); setInvalid(false); }} onBlur={commit}
      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />
    {invalid && <span className="block text-red-700">{min}–{max}</span>}
  </label>;
}

export function ModelControls({ config, onChange, locked, busy, diagnostics, lang }: Props) {
  const zh = lang === "zh", model = MODEL_CATALOG.find(model => model.id === config.kind)!;
  const forest = config.kind === "random-forest" || config.kind === "extra-trees";
  const bootstrapped = ["gradient-boosting", "ridge", "knn"].includes(config.kind);
  const field = (key: Exclude<keyof ModelConfig, "kind">, label: string, min: number, max: number, step = 1) => (
    <NumberSetting key={key} label={label} value={config[key]} min={min} max={max} step={step}
      onCommit={value => onChange({ ...config, [key]: value })} />
  );
  return <section className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 space-y-3" aria-label={zh ? "代理模型设置" : "Surrogate model settings"}>
    <h3 className="text-xs font-bold uppercase tracking-widest opacity-60">{zh ? "代理模型" : "Surrogate model"}</h3>
    <fieldset disabled={locked} className="space-y-3">
      <label className="block text-xs font-medium">
        {zh ? "模型类型" : "Model type"}
        <select aria-label={zh ? "模型类型" : "Model type"} value={config.kind}
          onChange={event => {
            const kind = event.target.value as ModelConfig["kind"];
            onChange({ ...config, kind, maxDepth: kind === "gradient-boosting" ? Math.min(config.maxDepth, 3) : config.maxDepth });
          }}
          className="w-full mt-1 bg-gray-50 border border-gray-200 rounded-lg p-2 text-sm disabled:opacity-50">
          {MODEL_CATALOG.map(model => <option key={model.id} value={model.id}>{zh ? model.zh : model.en}</option>)}
        </select>
      </label>
      <p className="text-xs leading-relaxed text-gray-600">{zh ? model.descriptionZh : model.descriptionEn}</p>
      <details>
        <summary className="text-xs font-medium cursor-pointer">{zh ? "模型参数" : "Model parameters"}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3">
          {field("seed", zh ? "训练 / 初始采样种子" : "Training / initial sampling seed", 0, 4294967295)}
          {config.kind === "gpr" && <>
            {field("lengthScale", zh ? "RBF 长度尺度倍率" : "RBF length-scale multiplier", 0.1, 10, 0.1)}
            {field("noise", zh ? "观测噪声 σ（标准化目标）" : "Observation noise σ (scaled target)", 0.0001, 2, 0.01)}
            <p className="text-[11px] text-gray-500">{zh ? "长度尺度 = 训练点距离中位数 × 倍率；噪声为建模假设，尚未自动调参。" : "Length scale = median training-pair distance × multiplier. Noise is an assumption; no automatic tuning."}</p>
          </>}
          {forest && field("trees", zh ? "树数量" : "Number of trees", 4, 128)}
          {(forest || config.kind === "gradient-boosting") && field("maxDepth", forest ? (zh ? "树最大深度" : "Max tree depth") : (zh ? "提升树深度（上限 3）" : "Boosting tree depth (capped at 3)"), 1, forest ? 10 : 3)}
          {bootstrapped && field("ensembleSize", zh ? "Bootstrap 模型数" : "Bootstrap model count", 4, 16)}
          {config.kind === "gradient-boosting" && <>
            {field("boostingRounds", zh ? "提升轮数" : "Boosting rounds", 5, 100)}
            {field("learningRate", zh ? "提升学习率" : "Boosting learning rate", 0.01, 0.5, 0.01)}
          </>}
          {config.kind === "knn" && field("neighbors", zh ? "近邻数量 k" : "Neighbors k", 1, 32)}
          {config.kind === "ridge" && field("ridgeAlpha", zh ? "岭回归正则 λ" : "Ridge regularization λ", 0.000001, 1000, 0.1)}
        </div>
      </details>
    </fieldset>
    {locked && <p className="text-[11px] text-gray-500">{zh ? "请先重置，再切换模型或参数，以保留独立的迭代记录。" : "Reset before changing models or parameters to keep runs separate."}</p>}
    <MethodNote lang={lang}>{zh ? "GP 后验依赖核与噪声假设；集成分歧不是已校准置信区间。对非 GP 使用 EI / UCB 为启发式策略。" : "GP posteriors depend on kernel/noise assumptions. Ensemble disagreement is not a calibrated interval; non-GP EI/UCB are heuristics."}</MethodNote>
    <div role="status" className="rounded-lg bg-blue-50 p-3 text-xs space-y-1" aria-live="polite">
      <p>{busy ? (zh ? "后台 Worker 正在训练 / 预测…" : "Worker training / predicting…") : (zh ? "训练与批量预测在后台 Worker 执行" : "Training and batch prediction run in a Worker")}</p>
      {diagnostics && <>
        <p>{zh ? "本轮训练" : "Trained on"}: {diagnostics.samples} × {diagnostics.dimensions}</p>
        <p>{zh ? "拟合 / 预测" : "Fit / predict"}: {diagnostics.trainMs.toFixed(1)} / {diagnostics.predictMs.toFixed(1)} ms</p>
      </>}
    </div>
  </section>;
}
