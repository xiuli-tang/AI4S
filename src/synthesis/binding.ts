import type { ReferenceBinding } from "./types";
export function sameReferenceBinding(a: ReferenceBinding | undefined, b: ReferenceBinding | undefined): boolean {
  const parts = (r: ReferenceBinding) => [r.kind, r.structureHash, r.recordKey ?? null,
    r.structureRef ? [r.structureRef.dataset, r.structureRef.id, r.structureRef.revision] : null,
    r.derived ? [r.derived.runId, r.derived.candidateId, r.derived.modelSha256, r.derived.parentStructureHash] : null];
  return !!a && !!b && JSON.stringify(parts(a)) === JSON.stringify(parts(b));
}
