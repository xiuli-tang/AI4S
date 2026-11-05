import { useI18n, userError } from "../i18n";
import { translateUI } from "../uiTranslations";
import React, { useState } from "react";
import type { ComparisonResult, XrdPattern, XrdPoint } from "../synthesis/types";

interface Props { pattern: XrdPattern; comparison?: ComparisonResult | null; compact?: boolean }
export default function XrdPlot({ pattern, comparison, compact = false }: Props) {
  const { lang } = useI18n(); const tr = (text: string) => translateUI(text, lang);
  const [hover, setHover] = useState<number | null>(null);
  const width = 960, height = compact ? 200 : 300, left = 48, right = 20, top = 20, bottom = 38;
  const maxIntensity = Math.max(100, ...pattern.profile.map(p => p.intensity));
  const scaleX = (x: number) => left+(x-pattern.min)/(pattern.max-pattern.min)*(width-left-right);
  const scaleY = (value: number) => height-bottom-value/110*(height-top-bottom);
  const path = (points: XrdPoint[], normalized = false) => points.map((p, i) => `${i ? "L" : "M"}${scaleX(p.twoTheta).toFixed(2)},${scaleY(normalized ? p.intensity : p.intensity/maxIntensity*100).toFixed(2)}`).join(" ");
  const nearest = hover === null ? null : pattern.peaks.reduce<typeof pattern.peaks[number] | null>((best, peak) => !best || Math.abs(peak.twoTheta-hover) < Math.abs(best.twoTheta-hover) ? peak : best, null);
  return <div className={`xrd-plot ${compact ? "xrd-compact" : ""}`}>
    <div className="xrd-legend"><span><i className="xrd-key-theory" />{tr("理论 XRD")}</span>{comparison && <><span><i className="xrd-key-exp" />{tr("实验谱")}</span><span><i className="xrd-key-fit" />{tr("多相拟合")}</span></>}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={tr("理论与实验 XRD 衍射谱图")}
      onMouseMove={event => { const box = event.currentTarget.getBoundingClientRect(); setHover(pattern.min+((event.clientX-box.left)/box.width*width-left)/(width-left-right)*(pattern.max-pattern.min)); }} onMouseLeave={() => setHover(null)}>
      {[0, 25, 50, 75, 100].map(tick => <g key={tick}><line x1={left} x2={width-right} y1={scaleY(tick)} y2={scaleY(tick)} stroke="#294255" strokeDasharray="3 6" /><text x={left-10} y={scaleY(tick)+4} textAnchor="end">{tick}</text></g>)}
      {Array.from({ length: Math.floor((pattern.max-pattern.min)/10)+1 }, (_, i) => pattern.min+i*10).map(tick => <g key={tick}><text x={scaleX(tick)} y={height-13} textAnchor="middle">{tick}°</text></g>)}
      {pattern.peaks.filter(p => p.intensity > 3).map((p, i) => <line key={i} x1={scaleX(p.twoTheta)} x2={scaleX(p.twoTheta)} y1={scaleY(0)} y2={scaleY(p.intensity/maxIntensity*100)} stroke="#71d9d5" strokeOpacity=".22" />)}
      <path d={path(pattern.profile)} fill="none" stroke="#65d6d1" strokeWidth={compact ? 2.2 : 1.8} />
      {comparison && <><path d={path(comparison.observed, true)} fill="none" stroke="#f4c271" strokeWidth="1.5" opacity=".8" /><path d={path(comparison.fitted, true)} fill="none" stroke="#a5afff" strokeWidth="1.2" strokeDasharray="5 3" />
        {comparison.unmatchedPeaks.map((p, i) => <g key={i}><line x1={scaleX(p.twoTheta)} x2={scaleX(p.twoTheta)} y1={top} y2={height-bottom} stroke="#ff8d9c" strokeDasharray="3 4" opacity=".45" /><circle cx={scaleX(p.twoTheta)} cy={scaleY(p.intensity)} r="3.4" fill="#ff8d9c" /></g>)}</>}
      <text x={width/2} y={height-1} textAnchor="middle">2θ / degrees</text>
      {nearest && hover !== null && Math.abs(nearest.twoTheta-hover) < 1.5 && <g><line x1={scaleX(nearest.twoTheta)} x2={scaleX(nearest.twoTheta)} y1={top} y2={height-bottom} stroke="#fff" opacity=".4" /><rect x={Math.min(width-208, Math.max(left, scaleX(nearest.twoTheta)+8))} y={top+4} width="190" height="43" rx="6" fill="#20364a" /><text x={Math.min(width-198, Math.max(left+10, scaleX(nearest.twoTheta)+18))} y={top+22} fill="#fff">{nearest.twoTheta.toFixed(3)}° · {nearest.hkl}</text><text x={Math.min(width-198, Math.max(left+10, scaleX(nearest.twoTheta)+18))} y={top+38}>d = {nearest.d.toFixed(3)} Å</text></g>}
    </svg>
  </div>;
}
