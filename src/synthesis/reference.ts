import type { Material } from "../types";
import type { CrystalStructure } from "../structures/types";
import { structureComposition } from "../structures/geometry";
import { MaterialStructureService } from "../services/MaterialStructureService";
import { materialRecordKey } from "../materialContext";
import { demoCrystal, sameComposition } from "./client";
import type { LabRequest, ReferenceBinding } from "./types";
import { structureFingerprint } from "../structures/fingerprint";
import { sameReferenceBinding } from "./binding";
export { structureFingerprint } from "../structures/fingerprint";

const service = new MaterialStructureService();
type Loader = (material: Material, signal?: AbortSignal) => ReturnType<MaterialStructureService["get"]>;
export function sameStructureRef(a: Material["structureRef"], b: Material["structureRef"]): boolean {
  return !!a && !!b && a.dataset === b.dataset && a.id === b.id && a.revision === b.revision;
}
export function materialForStructure(materials: Material[], structure: CrystalStructure): Material | undefined {
  if (structure.source.recordRef) return materials.find(row => sameStructureRef(row.structureRef, structure.source.recordRef));
  return structure.source.format === "materials-project"
    ? materials.find(row => row.source === "materials-project" && row.id === structure.source.materialId) : undefined;
}
/** A failed database lookup never becomes a substitute demonstration structure. */
export async function resolveSynthesisReference(request: LabRequest, material?: Material, signal?: AbortSignal,
  load: Loader = (row, signal) => service.get(row, signal)) {
  signal?.throwIfAborted();
  if (request.materialId && (!material || request.recordKey !== materialRecordKey(material))) {
    throw new Error("候选数据集或版本已变化，请重新关联当前候选。");
  }
  let structure: CrystalStructure;
  let kind: ReferenceBinding["kind"];
  const fromRecordViewer = material && sameStructureRef(request.structure?.source.recordRef, material.structureRef);
  if (material && material.source !== "mock" && (!request.structure || fromRecordViewer)) {
    const result = await load(material, signal);
    if (result.kind !== "ready") throw new Error("当前候选没有可用的对应数据库结构；请重试或独立导入结构分析。");
    structure = result.structure; kind = "record";
  } else if (request.structure) {
    structure = request.structure;
    kind = request.demonstration || structure.source.warnings.includes("演示构型") ? "demo" : "imported";
  } else {
    if (material && material.source !== "mock") throw new Error("真实候选需要其对应的数据库结构。");
    structure = demoCrystal(request.composition); kind = "demo";
  }
  if (material && !sameComposition(structureComposition(structure), material.composition)) {
    throw new Error("参考晶胞组成与关联候选不一致。");
  }
  const binding: ReferenceBinding = { kind, structureHash: await structureFingerprint(structure),
    ...(material ? { recordKey: materialRecordKey(material) } : {}),
    ...(kind === "record" && material?.structureRef ? { structureRef: { ...material.structureRef } } : {}) };
  if (kind === "imported" && request.referenceBinding?.kind === "derived" && material?.validationStructure
    && request.referenceBinding.structureHash === binding.structureHash
    && sameReferenceBinding(request.referenceBinding, material.validationStructure)) {
    Object.assign(binding, structuredClone(request.referenceBinding));
  }
  signal?.throwIfAborted();
  return { structure, binding };
}
