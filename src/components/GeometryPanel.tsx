import { useEffect, useRef, useState } from "react";
import type { GeometryResult, StructureArtifact } from "../research/types";
import type { Material } from "../types";
import { materialRecordKey } from "../materialContext";
import { measureGeometry, isMetalCenter } from "../research/geometry";
import { sameComposition } from "../synthesis/client";
import { structureComposition } from "../structures/geometry";

export default function GeometryPanel({ artifact, materials, references, open, onClose, onApply }: {
  artifact: StructureArtifact | null; materials: Material[]; references: StructureArtifact[]; open: boolean; onClose(): void;
  onApply(material: Material, result: GeometryResult): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), operation = useRef(0);
  const [materialKey, setMaterialKey] = useState(""), [center, setCenter] = useState(0), [cutoff, setCutoff] = useState(2.5), [referenceId, setReferenceId] = useState("");
  const [result, setResult] = useState<GeometryResult | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const linked = artifact ? materials.filter(m => sameComposition(m.composition, structureComposition(artifact.structure))) : [];
  const material = linked.find(m => materialRecordKey(m) === materialKey);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  useEffect(() => {
    operation.current++; setResult(null); setError(""); setBusy(false); setReferenceId("");
    setMaterialKey(artifact?.recordKey ?? "");
    const site = artifact?.structure.sites.findIndex(s => s.species.length === 1 && isMetalCenter(s.species[0].element)); setCenter(Math.max(0, site ?? 0));
  }, [artifact?.id]);
  useEffect(() => { operation.current++; setResult(null); }, [materialKey, center, cutoff, referenceId]);
  async function calculate() {
    if (!artifact || !material) return; const serial = ++operation.current; setBusy(true); setError("");
    try {
      const value = await measureGeometry(artifact.structure, materialRecordKey(material), center, cutoff, references.find(a => a.id === referenceId)?.structure);
      if (serial === operation.current) setResult(value);
    } catch (e) { if (serial === operation.current) setError((e as Error).message); }
    finally { if (serial === operation.current) setBusy(false); }
  }
  return <dialog ref={dialog} className="research-dialog" onCancel={e => { e.preventDefault(); onClose(); }}><header><div><small>STRUCTURE → PHYSICAL DESCRIPTORS</small><h2>结构几何量 → 白盒公式</h2></div><button onClick={onClose}>关闭</button></header>
    <div className="research-dialog-content">{artifact && <>
      <p>{artifact.structure.name} · {artifact.stage} · {artifact.structureHash.slice(0, 12)}</p>
      <div className="research-form-grid"><label>关联材料<select aria-label="几何量关联材料" value={materialKey} onChange={e => setMaterialKey(e.target.value)}><option value="">选择同成分记录</option>{linked.map(m => <option key={materialRecordKey(m)} value={materialRecordKey(m)}>{m.formula} · {m.id}</option>)}</select></label><label>中心位点<select aria-label="几何中心位点" value={center} onChange={e => setCenter(Number(e.target.value))}>{artifact.structure.sites.map((site, i) => <option key={site.id} value={i}>{i + 1} · {site.label}</option>)}</select></label><label>O邻域截断 / Å<input aria-label="几何邻域截断" type="number" min={.5} max={8} step={.1} value={cutoff} onChange={e => setCutoff(Number(e.target.value))} /></label><label>体积参考<select aria-label="几何体积参考" value={referenceId} onChange={e => setReferenceId(e.target.value)}><option value="">暂不计算体积差</option>{references.filter(a => a.id !== artifact.id).map(a => <option key={a.id} value={a.id}>{a.structure.name} · {a.stage}</option>)}</select></label></div>
      <button className="research-primary" disabled={!material || busy} onClick={() => void calculate()}>{busy ? "计算中…" : "计算周期几何量"}</button>
      {error && <p role="alert">{error}</p>}{result && <div className="research-geometry-result"><p>{result.note}</p><table><tbody>{[["O邻居数", result.neighbors.length, ""], ["M–O平均键长", result.meanBondLength, "Å"], ["键长总体方差", result.bondVariance, "Å²"], ["八面体键长畸变", result.octahedralDistortion, "1"], ["每原子体积差", result.volumeChangePerAtom, "Å³/atom"]].map(([label, value, unit]) => <tr key={String(label)}><th>{label}</th><td>{value == null ? "—" : Number(value).toPrecision(6)} {unit}</td></tr>)}</tbody></table><button className="research-primary" onClick={() => material && onApply(material, result)}>送入当前材料的白盒补充数据</button><p className="research-muted">保留周期映像、中心位点、截断、算法版本与结构摘要。</p></div>}
    </>}</div></dialog>;
}
