import type { CrystalStructure } from "./types";

/** Shared DOM-free digest of the normalized geometry used by Engine and XRD. */
export function geometryIdentity(structure: CrystalStructure): string {
  return JSON.stringify({ lattice: structure.lattice,
    sites: structure.sites.map(site => ({ fractional: site.fractional,
      species: [...site.species].sort((a, b) => a.element.localeCompare(b.element)) })) });
}
export async function structureFingerprint(structure: CrystalStructure): Promise<string> {
  const bytes = new TextEncoder().encode(geometryIdentity(structure));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
}
