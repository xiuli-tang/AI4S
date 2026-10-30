import type { CrystalStructure } from "../structures/types";
import { cross, determinant, fractionalToCartesian, norm, validateLattice, structureComposition } from "../structures/geometry";
import { structureFingerprint } from "../structures/fingerprint";
import { normalizeComposition } from "../engine/CompositionFeatures";
import type { GeometryResult } from "./types";
import type { Supplements } from "../engine/distillation/types";

const nonMetals = new Set("H He B C N O F Ne Si P S Cl Ar Ge As Se Br Kr Sb Te I Xe At Rn Ts Og".split(" "));
export const isMetalCenter = (element: string) => !nonMetals.has(element);
export const GEOMETRY_FIELDS = ["mean_mo_bond_length", "mo_bond_variance", "octahedral_distortion", "volume_change_per_atom"] as const;
export function replaceGeometrySupplements(previous: Supplements, materialId: string, result: GeometryResult): Supplements {
  const retained = Object.fromEntries(Object.entries(previous[materialId] ?? {}).filter(([key]) => !GEOMETRY_FIELDS.includes(key as typeof GEOMETRY_FIELDS[number])));
  return { ...previous, [materialId]: { ...retained, ...geometrySupplements(materialId, result)[materialId] } };
}

export async function measureGeometry(structure: CrystalStructure, recordKey: string, centerSiteIndex: number, cutoff: number,
  reference?: CrystalStructure): Promise<GeometryResult> {
  const lattice = validateLattice(structure.lattice), center = structure.sites[centerSiteIndex];
  if (!center || !Number.isFinite(cutoff) || cutoff < .5 || cutoff > 8) throw new Error("请选择中心位点及0.5–8 Å邻域。");
  for (const crystal of reference ? [structure, reference] : [structure]) {
    validateLattice(crystal.lattice);
    if (crystal.sites.some(s => s.species.length !== 1 || s.species[0].occupancy !== 1)) throw new Error("几何补充量与体积参考需要满占位有序结构。");
    if (crystal.source.warnings.some(w => /未.*补全晶胞|未.*对称|not.*expand/i.test(w))) throw new Error("请先补全结构对称位点。");
  }
  if (!isMetalCenter(center.species[0].element)) throw new Error("M–O描述符请选择金属中心；非金属及类金属不作为M中心。");
  const volume = Math.abs(determinant(lattice));
  const reciprocal = [cross(lattice[1], lattice[2]), cross(lattice[2], lattice[0]), cross(lattice[0], lattice[1])].map(b => norm(b) / volume);
  const neighbors: GeometryResult["neighbors"] = [];
  let attempts = 0;
  for (let siteIndex = 0; siteIndex < structure.sites.length; siteIndex++) {
    const site = structure.sites[siteIndex]; if (site.species[0].element !== "O") continue;
    const delta = site.fractional.map((v, i) => v - center.fractional[i]);
    const bounds = delta.map((v, i) => [Math.ceil(-v - cutoff * reciprocal[i]), Math.floor(-v + cutoff * reciprocal[i])]);
    for (let i = bounds[0][0]; i <= bounds[0][1]; i++) for (let j = bounds[1][0]; j <= bounds[1][1]; j++) for (let k = bounds[2][0]; k <= bounds[2][1]; k++) {
      if (++attempts > 200000) throw new Error("邻域过大，请减小截断半径。");
      const distance = norm(fractionalToCartesian([delta[0] + i, delta[1] + j, delta[2] + k], lattice));
      if (distance > 1e-8 && distance <= cutoff + 1e-9) neighbors.push({ siteIndex, image: [i, j, k], distance });
    }
  }
  neighbors.sort((a, b) => a.distance - b.distance || a.siteIndex - b.siteIndex);
  const mean = neighbors.length ? neighbors.reduce((s, n) => s + n.distance, 0) / neighbors.length : null;
  const variance = mean === null ? null : neighbors.reduce((s, n) => s + (n.distance - mean) ** 2, 0) / neighbors.length;
  let volumeChangePerAtom: number | null = null;
  if (reference) {
    const composition = (s: CrystalStructure) => JSON.stringify(Object.entries(normalizeComposition(structureComposition(s))).sort().map(([el, n]) => [el, Number(n.toPrecision(10))]));
    if (composition(structure) !== composition(reference)) throw new Error("体积参考必须与当前结构具有相同组成比例。");
    volumeChangePerAtom = volume / structure.sites.length - Math.abs(determinant(reference.lattice)) / reference.sites.length;
  }
  return { algorithm: "periodic-mo-shell-1", structureHash: await structureFingerprint(structure), recordKey, centerSiteIndex, cutoff, neighbors,
    meanBondLength: mean, bondVariance: variance, octahedralDistortion: neighbors.length === 6 && mean ? variance! / mean ** 2 : null,
    volumeChangePerAtom, ...(reference ? { referenceStructureHash: await structureFingerprint(reference) } : {}),
    note: neighbors.length === 6 ? "六配位M–O键长统计" : `截断内有${neighbors.length}个O邻居；八面体畸变待定义` };
}
export function geometrySupplements(materialId: string, result: GeometryResult): Supplements {
  const entries = [["mean_mo_bond_length", result.meanBondLength, "Å"], ["mo_bond_variance", result.bondVariance, "Å²"],
    ["octahedral_distortion", result.octahedralDistortion, "1"], ["volume_change_per_atom", result.volumeChangePerAtom, "Å³/atom"]] as const;
  return { [materialId]: Object.fromEntries(entries.filter(([, v]) => v !== null).map(([key, value, unit]) => [key, {
    value: value!, unit, source: result.algorithm, reference: `中心位点${result.centerSiteIndex + 1}; cutoff=${result.cutoff} Å; ${result.note}`,
    binding: { recordKey: result.recordKey, structureHash: result.structureHash, algorithm: result.algorithm,
      centerSiteIndex: result.centerSiteIndex, cutoff: result.cutoff, referenceStructureHash: result.referenceStructureHash },
  }])) };
}
