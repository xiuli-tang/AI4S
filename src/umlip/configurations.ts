import type { CrystalStructure, Lattice, Vec3 } from "../structures/types";
import { cross, determinant, fractionalToCartesian, minimumImageDistance, norm, validateLattice, wrapFractional } from "../structures/geometry";
import { element } from "../structures/elements";
import { getElementConstants } from "../engine/CompositionFeatures";
import type { AtomicConfiguration, ConfigurationInput, UmlipSettings } from "./types";

export const UMLIP_LIMITS = { atoms: 128, candidates: 32, steps: 200 };
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const vec = (x: unknown): Vec3 => {
  if (!Array.isArray(x) || x.length !== 3 || !x.every(finite) || x.some(v => Math.abs(v) > 1e5)) throw new Error("坐标或晶格须为三个有限数值。");
  return [...x] as Vec3;
};

export function validateConfiguration(input: unknown): AtomicConfiguration {
  const s = input as AtomicConfiguration;
  if (s && (("charge" in s && (s as any).charge !== 0) || "magneticMoments" in s || "spin" in s)) throw new Error("首版不支持指定带电状态、磁矩或自旋分支。");
  if (!s || !Array.isArray(s.cell) || s.cell.length !== 3) throw new Error("缺少三维晶胞。");
  const cell = validateLattice(s.cell.map(vec) as Lattice);
  const lengths = cell.map(norm), volume = Math.abs(determinant(cell));
  if (Math.min(...lengths) < 0.5 || Math.max(...lengths) > 100 || volume / lengths.reduce((a, b) => a * b, 1) < 0.05) throw new Error("晶胞过小、过大或过度倾斜，超出首版计算范围。");
  // Bound the exact shortest nonzero lattice translation using reciprocal norms.
  const best = Math.min(...lengths);
  const bounds = [cross(cell[1], cell[2]), cross(cell[2], cell[0]), cross(cell[0], cell[1])].map(v => Math.floor(best * norm(v) / volume + 1e-9));
  if (bounds.reduce((n, b) => n * (2 * b + 1), 1) > 100000) throw new Error("晶胞过度倾斜，周期镜像检查超出计算范围。");
  for (let i = -bounds[0]; i <= bounds[0]; i++) for (let j = -bounds[1]; j <= bounds[1]; j++) for (let k = -bounds[2]; k <= bounds[2]; k++) {
    if ((i || j || k) && norm(fractionalToCartesian([i, j, k], cell)) < 0.5) throw new Error("原子与自身周期镜像小于 0.5 Å，请检查晶胞。");
  }
  if (!Array.isArray(s.elements) || s.elements.length < 1 || s.elements.length > UMLIP_LIMITS.atoms || s.elements.some(e => typeof e !== "string" || element(e) !== e)) throw new Error(`仅支持 1–${UMLIP_LIMITS.atoms} 个已知元素原子。`);
  if (!Array.isArray(s.fractional) || s.fractional.length !== s.elements.length) throw new Error("原子数与坐标数不一致。");
  if (!Array.isArray(s.pbc) || s.pbc.length !== 3 || s.pbc.some(v => v !== true)) throw new Error("首版仅支持三维周期晶体。");
  if (!Array.isArray(s.movable) || s.movable.length !== s.elements.length || s.movable.some(row => !Array.isArray(row) || row.length !== 3 || row.some(v => typeof v !== "boolean"))) throw new Error("缺少有效的 Direct 基矢运动约束。");
  if (!s.movable.some(row => row.some(Boolean))) throw new Error("全部原子均被冻结，无法执行结构弛豫。");
  const fractional = s.fractional.map(row => wrapFractional(vec(row)));
  for (let i = 0; i < fractional.length; i++) for (let j = i + 1; j < fractional.length; j++) {
    if (minimumImageDistance(fractional[i], fractional[j], cell) < 0.5) throw new Error("存在小于 0.5 Å 的周期原子间距，请先检查结构。");
  }
  return { cell: cell.map(row => [...row]) as Lattice, elements: [...s.elements], fractional,
    movable: s.movable.map(row => [...row]), pbc: [true, true, true] };
}

export function fromCrystalStructure(structure: CrystalStructure): AtomicConfiguration {
  if (structure.source.format === "cif" && structure.source.warnings.some(w => /未.*补全晶胞|未.*对称|not.*expand/i.test(w))) throw new Error("CIF 可能仅包含非对称单元；请提供完整 P1 晶胞或完整对称操作。");
  if (structure.sites.some(site => site.species.length !== 1 || Math.abs(site.species[0].occupancy - 1) > 1e-8)) throw new Error("计算需要单元素满占位位点；请先明确有序化混占或部分占位结构。");
  return validateConfiguration({ cell: structure.lattice, elements: structure.sites.map(site => site.species[0].element),
    fractional: structure.sites.map(site => site.fractional), movable: structure.sites.map(site => site.selective ?? [true, true, true]), pbc: [true, true, true] });
}

export function compositionOf(s: AtomicConfiguration): Record<string, number> {
  return Object.fromEntries([...new Set(s.elements)].sort().map(e => [e, s.elements.filter(x => x === e).length]));
}

export function validatePool(inputs: unknown): ConfigurationInput[] {
  if (!Array.isArray(inputs) || inputs.length < 2 || inputs.length > UMLIP_LIMITS.candidates) throw new Error(`请提供 2–${UMLIP_LIMITS.candidates} 个同成分构型。`);
  const ids = new Set<string>();
  const pool = inputs.map((item: any) => {
    if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id)) throw new Error("候选 ID 无效或重复。");
    ids.add(item.id);
    if (item.origin && (typeof item.origin.recordKey !== "string" || item.origin.recordKey.length > 4000 || !/^[a-f0-9]{64}$/.test(item.origin.structureHash))) throw new Error("构型材料来源绑定无效。");
    return { id: item.id, name: String(item.name ?? item.id).slice(0, 160), source: String(item.source ?? "user input").slice(0, 300), structure: validateConfiguration(item.structure),
      ...(item.origin ? { origin: { recordKey: item.origin.recordKey, structureHash: item.origin.structureHash, materialId: item.origin.materialId } } : {}) };
  });
  const first = pool[0].structure, key = JSON.stringify(compositionOf(first));
  for (const candidate of pool) {
    if (JSON.stringify(compositionOf(candidate.structure)) !== key) throw new Error("候选必须具有完全相同的元素计数和原子数；不能混入不同超胞倍数或掺杂浓度。");
    // Matching element order makes per-atom Direct constraints comparable and preserves lineage.
    if (JSON.stringify(candidate.structure.elements) !== JSON.stringify(first.elements) || JSON.stringify(candidate.structure.movable) !== JSON.stringify(first.movable)) throw new Error("请统一原子元素顺序与运动约束，再进行同成分比较。");
  }
  return pool;
}

export function validateSettings(input: Partial<UmlipSettings>, count: number): UmlipSettings {
  const s = { budget: Math.min(count, 6), initialSamples: 2, batchSize: 2, fmax: 0.08, maxSteps: 100, seed: 42, ...input };
  if (input.initialSamples === undefined) s.initialSamples = Math.min(2, s.budget);
  for (const [key, low, high] of [["budget", 1, count], ["initialSamples", 1, Math.min(s.budget, count)], ["batchSize", 1, 4], ["maxSteps", 1, UMLIP_LIMITS.steps], ["seed", 0, 0xffffffff]] as const) {
    if (!Number.isSafeInteger(s[key]) || s[key] < low || s[key] > high) throw new Error(`${key} 超出允许范围 ${low}–${high}。`);
  }
  if (!finite(s.fmax) || s.fmax < 0.005 || s.fmax > 1) throw new Error("力阈值范围为 0.005–1 eV/Å。");
  return s;
}

/** Deterministic initial-geometry features, with no energy evaluations or hidden labels.
 * Minimum-image pair distances feed smooth RBF bins, also weighted by atomic numbers.
 * This finite descriptor is not a unique crystal identifier or a calibrated chemical metric.
 */
export function configurationFeatures(s: AtomicConfiguration): number[] {
  const plain = Array(16).fill(0), weighted = Array(16).fill(0), distances: number[] = [];
  for (let i = 0; i < s.elements.length; i++) for (let j = i + 1; j < s.elements.length; j++) {
    const d = minimumImageDistance(s.fractional[i], s.fractional[j], s.cell);
    distances.push(d);
    const weight = Math.sqrt(getElementConstants(s.elements[i])!.atomicNumber * getElementConstants(s.elements[j])!.atomicNumber) / 100;
    for (let k = 0; k < 16; k++) {
      const value = Math.exp(-(((d - (0.5 + 0.5 * k)) / 0.5) ** 2));
      plain[k] += value; weighted[k] += value * weight;
    }
  }
  const n = Math.max(1, distances.length), mean = distances.reduce((a, b) => a + b, 0) / n;
  return [...plain.map(x => x / n), ...weighted.map(x => x / n), Math.abs(determinant(s.cell)) / s.elements.length / 100,
    ...s.cell.map(norm).sort((a, b) => a - b).map(x => x / 10), mean / 10,
    Math.sqrt(distances.reduce((sum, d) => sum + (d - mean) ** 2, 0) / n) / 10];
}

export function asCrystalStructure(s: AtomicConfiguration, name: string, source: string): CrystalStructure {
  return { schemaVersion: 1, name, lattice: s.cell,
    sites: s.elements.map((e, i) => ({ id: `site-${i}`, label: `${e}${i + 1}`, fractional: s.fractional[i], species: [{ element: e, occupancy: 1 }], sourceLabels: [`${e}${i + 1}`], selective: s.movable[i] })),
    source: { filename: source, format: "poscar", coordinateMode: "direct", symmetry: "listed-sites", warnings: ["uMLIP 模型输入或弛豫结构，不是 DFT/实验验证结构。"], raw: "" } };
}
