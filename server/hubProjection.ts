import { createHash } from "node:crypto";
import type { HubRecord } from "../src/dataHub";
import { normalizeMaterialStructure } from "../src/structures/materialStructure";
import { geometryIdentity } from "../src/structures/fingerprint";

/** A bounded digest cache; geometry and the canonical revision remain in the source store. */
export function createHubProjection() {
  const hashes = new Map<string, string>();
  return (row: HubRecord, revision: string): HubRecord => {
    const { structure, symmetry, ...properties } = row;
    let structureHash: string | undefined;
    if (structure) {
      structureHash = hashes.get(revision);
      if (!structureHash) {
        const normalized = normalizeMaterialStructure({ material_id: row.id, formula_pretty: row.formula, structure, symmetry },
          row.id, (row.structureProvenance ?? row.provenance).retrievedAt, true);
        structureHash = createHash("sha256").update(geometryIdentity(normalized)).digest("hex");
        if (hashes.size >= 10000) hashes.delete(hashes.keys().next().value!);
        hashes.set(revision, structureHash);
      }
    }
    return { ...properties, revision, hasStructure: !!structure, ...(structureHash ? { structureHash } : {}) };
  };
}
