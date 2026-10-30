import React, { useEffect, useMemo, useState } from "react";
import type { Material } from "../types";
import MethodNote from "./MethodNote";
import {
  ELEMENT_SYMBOLS, ELEMENT_TABLE_VERSION, FEATURE_DEFINITIONS, PROPERTY_DEFINITIONS,
  extractCompositionFeatures, getElementConstants,
} from "../engine/CompositionFeatures";

const format = (value: number | null | undefined) => value == null ? "—" : Number(value.toPrecision(7)).toString();

export function CompositionDescriptorPanel({ materials, lang }: { materials: Material[]; lang: "zh" | "en" }) {
  const zh = lang === "zh";
  const first = materials[0];
  const [selectedId, setSelectedId] = useState(first?.id ?? "");
  const [text, setText] = useState(JSON.stringify(first?.composition ?? { Sr: 1, Ti: 1, O: 3 }));
  const [element, setElement] = useState("Li");
  useEffect(() => {
    if (!selectedId) return;
    const selected = materials.find(material => material.id === selectedId);
    if (selected) setText(JSON.stringify(selected.composition));
    else setSelectedId("");
  }, [materials, selectedId]);
  const result = useMemo<{ value: ReturnType<typeof extractCompositionFeatures> | null; error: string | null }>(() => {
    try {
      return { value: extractCompositionFeatures(JSON.parse(text)), error: null };
    } catch (error) {
      return { value: null, error: error instanceof Error ? error.message : "Invalid composition" };
    }
  }, [text]);
  const record = getElementConstants(element)!;
  const descriptors = result.value?.descriptors;
  const tolerance = descriptors?.toleranceFactor;
  const heading = "text-xs font-bold uppercase tracking-widest opacity-60";

  return (
    <section className="max-w-7xl mx-auto mt-8 p-6 bg-white text-[#172B42] rounded-3xl border border-gray-200 space-y-5" aria-labelledby="composition-descriptors-heading">
      <div>
        <h2 id="composition-descriptors-heading" className="text-lg font-semibold">
          {zh ? "元素常数与组成描述符" : "Element constants and composition descriptors"}
        </h2>
        <p className="text-sm text-gray-600 mt-1">
          {zh ? "同一 composition 总是得到相同描述符；表中为原始单位，模型输入另按固定尺度归一化。" : "The same composition always gives the same descriptors. Raw units are shown below; model inputs use fixed scales."}
        </p>
      </div>
      <div className="grid md:grid-cols-2 gap-5">
        <div className="space-y-3">
          <label htmlFor="descriptor-material" className={heading}>{zh ? "使用候选组成（前200条）" : "Candidate composition (first 200)"}</label>
          <select id="descriptor-material" value={selectedId} className="block w-full p-2 rounded-lg border border-gray-300" onChange={event => {
            setSelectedId(event.target.value);
            const material = materials.find(entry => entry.id === event.target.value);
            if (material) setText(JSON.stringify(material.composition));
          }}>
            <option value="">{zh ? "自定义组成" : "Custom composition"}</option>
            {materials.slice(0, 200).map(material => <option key={material.id} value={material.id}>{material.id} · {material.formula}</option>)}
          </select>
          <label htmlFor="descriptor-composition" className={heading}>{zh ? "组成 JSON（元素计数或原子分数）" : "Composition JSON (counts or atomic fractions)"}</label>
          <textarea id="descriptor-composition" rows={3} value={text} spellCheck={false} className="block w-full p-3 rounded-lg border border-gray-300 font-mono text-sm" onChange={event => {
            setSelectedId("");
            setText(event.target.value);
          }} />
          <button type="button" className="px-3 py-2 border border-gray-300 rounded-lg text-sm" onClick={() => {
            setSelectedId("");
            setText('{"Sr":1,"Ti":1,"O":3}');
          }}>{zh ? "载入 SrTiO₃ 示例" : "Load SrTiO₃ example"}</button>
          {result.error && <p role="alert" className="text-sm text-red-700">{zh ? "组成无效：" : "Invalid composition: "}{result.error}</p>}
          {descriptors && <p className="text-xs text-gray-600 break-words">{zh ? "原子分数：" : "Atomic fractions: "}{Object.entries(descriptors.fractions).map(([symbol, fraction]) => `${symbol}=${format(fraction)}`).join(" · ")}</p>}
        </div>
        <div className="p-4 rounded-xl bg-slate-50 space-y-2" aria-live="polite">
          <h3 className={heading}>{zh ? "Goldschmidt 容忍因子" : "Goldschmidt tolerance factor"}</h3>
          <p className="font-mono text-xl">t = {format(tolerance?.value)}</p>
          <p className="text-sm">t = (rA + rO) / [√2(rB + rO)]</p>
          {tolerance?.model ? <>
            <p className="text-xs">A: {tolerance.model.a.element} {tolerance.model.a.oxidationState > 0 ? "+" : ""}{tolerance.model.a.oxidationState}, CN12, {tolerance.model.a.radiusAngstrom} Å<br />B: {tolerance.model.b.element} +{tolerance.model.b.oxidationState}, CN6, {tolerance.model.b.radiusAngstrom} Å ({tolerance.model.b.spin})<br />O: −2, CN6, {tolerance.model.oxygen.radiusAngstrom} Å</p>
            <MethodNote lang={lang}>{zh ? "这是 ABO₃ 参考位点/价态模型下的几何估算；结构和稳定性由对应结构计算或实验另行确认。" : "A geometric estimate under reference ABO₃ sites/charges; structure and stability are assessed using corresponding calculations or experiments."}</MethodNote>
          </> : <p className="text-sm">{zh ? "不适用：需满足 ABO₃ 比例、电荷平衡、唯一 A/B 参考位点及相应 Shannon 半径。" : "Not applicable: requires ABO₃ ratios, charge balance, unique reference A/B sites and matching Shannon radii."}</p>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border-collapse" aria-label={zh ? "组成加权物理描述符" : "Composition-weighted physical descriptors"}>
          <thead><tr className="border-b border-gray-300 text-left"><th className="p-2">{zh ? "属性 / 单位" : "Property / unit"}</th><th className="p-2">{zh ? "加权均值" : "Weighted mean"}</th><th className="p-2">{zh ? "总体方差（单位²）" : "Population variance (unit²)"}</th><th className="p-2">{zh ? "极差" : "Range"}</th><th className="p-2">{zh ? "数据覆盖率" : "Coverage"}</th></tr></thead>
          <tbody>{PROPERTY_DEFINITIONS.map(property => {
            const stats = descriptors?.statistics[property.key];
            return <tr key={property.key} className="border-b border-gray-100"><th className="p-2 text-left font-normal">{zh ? property.label : property.english} / {property.unit}</th><td className="p-2 font-mono">{format(stats?.mean)}</td><td className="p-2 font-mono">{format(stats?.variance)}</td><td className="p-2 font-mono">{format(stats?.range)}</td><td className="p-2">{stats ? `${format(stats.coverage * 100)}%` : "—"}{stats?.missingElements.length ? ` (${stats.missingElements.join(", ")})` : ""}</td></tr>;
          })}</tbody>
        </table>
      </div>
      <MethodNote lang={lang}>{zh ? "μ=Σxᵢpᵢ；σ²=Σxᵢ(pᵢ−μ)²；极差=max(pᵢ)−min(pᵢ)。组成元素缺值时保留覆盖率与缺失状态，不对部分元素重新归一化。" : "μ=Σxᵢpᵢ; σ²=Σxᵢ(pᵢ−μ)²; range=max−min. Missing constituents retain their coverage and missing status."}</MethodNote>
      <details className="text-sm space-y-3">
        <summary className="cursor-pointer font-medium">{zh ? "查看内置元素常数、参考态与来源" : "Inspect offline constants, reference states and sources"} ({ELEMENT_SYMBOLS.length})</summary>
        <label htmlFor="element-constant" className="block mt-3">{zh ? "元素" : "Element"}</label>
        <select id="element-constant" value={element} onChange={event => setElement(event.target.value)} className="p-2 border border-gray-300 rounded-lg">
          {ELEMENT_SYMBOLS.map(symbol => <option key={symbol} value={symbol}>{getElementConstants(symbol)!.atomicNumber} · {symbol} · {getElementConstants(symbol)!.name}</option>)}
        </select>
        <p className="font-mono text-xs break-words">χ={format(record.electronegativityPauling)}; r(cov)={format(record.covalentRadiusAngstrom)} Å; N(val)={format(record.valenceElectrons)}; I₁={format(record.firstIonizationEnergyEv)} eV; EA={format(record.electronAffinityEv)} eV; η={format(record.chemicalHardnessEv)} eV</p>
        <p className="text-xs">{zh ? "离子半径参考：" : "Ionic radius reference: "}{record.referenceIon ? `${element} (${record.referenceIon.oxidationState}), CN${record.referenceIon.coordinationNumber}, ${record.referenceIon.spin}, ${record.referenceIon.radiusAngstrom} Å` : (zh ? "没有统一参考值" : "No reference value")}</p>
        <p className="text-xs">{zh ? "离子半径依赖价态、配位和自旋；这里是固定参考态，不代表该化合物的实际离子。价电子计数按中性原子构型：主族取外层s/p，过渡金属再含(n−1)d，f区再含(n−2)f；不是氧化态。" : "Ionic radii depend on charge, coordination and spin. Fixed references do not identify ions in a compound. Valence counts use outer s/p plus d for d-block and d/f for f-block, not oxidation states."}</p>
        <p className="text-xs">{zh ? "化学硬度采用原子有限差分 η=(I₁−EA)/2；并未冒充氧化物键解离能。组成描述符不能区分同质异构体。" : "Atomic hardness uses η=(I₁−EA)/2; it is not oxide bond dissociation energy. Composition descriptors cannot distinguish polymorphs."}</p>
        <p className="text-xs"><a className="underline" href="https://github.com/materialsproject/pymatgen/tree/v2025.6.14">pymatgen 2025.6.14</a> · <a className="underline" href="https://doi.org/10.1039/B801115J">Cordero 2008</a> · <a className="underline" href="https://doi.org/10.1107/S0567739476001551">Shannon 1976</a></p>
        <p className="font-mono text-xs break-words">{ELEMENT_TABLE_VERSION} · {descriptors?.schemaVersion} · {FEATURE_DEFINITIONS.length} model features</p>
      </details>
    </section>
  );
}
