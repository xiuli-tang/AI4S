import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { OBJECTIVES, type FidelityPair, type HubCatalog, type HubQuery, type HubRecord, type ObjectiveId, type Provenance, type StoredHubSource } from "../src/dataHub";
import { getElementConstants, normalizeComposition } from "../src/engine/CompositionFeatures";
import { normalizeMaterialStructure } from "../src/structures/materialStructure";

export class HubInputError extends Error {}
const tables = { "mp-snapshot": "mp_snapshot", "catalysis-hub": "catalysis_records", "dual-fidelity": "dual_fidelity_pairs" } as const;
const plain = (x: any) => x !== null && typeof x === "object" && !Array.isArray(x);
function required(value: unknown, name: string, max = 800): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new HubInputError(`缺少或无效字段：${name}`);
  return value.trim();
}
function identifier(value: unknown) {
  const id = required(value, "id", 100);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id)) throw new HubInputError("id 仅允许字母、数字及 . _ : -。");
  return id;
}
function composition(value: any) {
  try { normalizeComposition(value); } catch { throw new HubInputError("组成必须使用有效元素符号和有限非负计数，并至少有一个正计数。"); }
  return Object.fromEntries(Object.entries(value).filter(([, n]) => Number(n) > 0)) as Record<string, number>;
}
function finite(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e9) throw new HubInputError(`缺少或无效数值：${name}`);
  return value;
}
export function validateProvenance(input: any): Provenance {
  if (!plain(input)) throw new HubInputError("每条记录必须提供 provenance 来源。");
  const reference = required(input.reference, "provenance.reference", 2000);
  const url = required(input.url, "provenance.url", 2000);
  if (/REPLACE|填写|TODO|example\.(com|org)/i.test([reference, url, input.datasetVersion, input.license].join(" "))) throw new HubInputError("请用真实来源替换模板占位信息。");
  try { const parsed = new URL(url); if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error(); }
  catch { throw new HubInputError("来源链接必须是无凭据的 HTTP(S) URL。"); }
  const retrievedAt = required(input.retrievedAt, "provenance.retrievedAt", 50);
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new HubInputError("来源时间必须可解析。");
  return { reference, url, retrievedAt, datasetVersion: required(input.datasetVersion, "provenance.datasetVersion"),
    license: required(input.license, "provenance.license"),
    ...(Array.isArray(input.taskIds) ? { taskIds: input.taskIds.slice(0, 50).map((id: unknown) => required(id, "taskId", 100)) } : {}) };
}
function checkedStructure(value: unknown, id: string, formula: string, time: string, expected: Record<string, number>) {
  if (value == null) return undefined;
  try {
    const structure = normalizeMaterialStructure({ material_id: id, formula_pretty: formula, structure: value }, id, time, true);
    const counts: Record<string, number> = {};
    for (const site of structure.sites) for (const species of site.species) counts[species.element] = (counts[species.element] ?? 0) + species.occupancy;
    const actualFractions = normalizeComposition(counts), expectedFractions = normalizeComposition(expected);
    const symbols = new Set([...Object.keys(actualFractions), ...Object.keys(expectedFractions)]);
    if ([...symbols].some(symbol => Math.abs((actualFractions[symbol] ?? 0) - (expectedFractions[symbol] ?? 0)) > 1e-6)) throw new Error("Composition mismatch");
  }
  catch { throw new HubInputError("结构必须包含有效晶胞、坐标和占位，且占位归一化组成须与记录匹配；不能由化学式伪造。"); }
  return value;
}
export function validateHubRecord(input: any): HubRecord {
  if (!plain(input)) throw new HubInputError("记录必须为对象。");
  const id = identifier(input.id), formula = required(input.formula, "formula", 200);
  const provenance = validateProvenance(input.provenance), parsedComposition = composition(input.composition);
  const structureProvenance = input.structureProvenance ? validateProvenance(input.structureProvenance) : provenance;
  if (!["MP-DFT", "Catalysis-Hub", "GNoME-Extrapolated", "Lab-Experiment"].includes(input.source)) throw new HubInputError("source 无效。");
  if (!["low-dft", "mid-umlip", "high-exp"].includes(input.fidelity)) throw new HubInputError("fidelity 无效。");
  if (input.source === "Lab-Experiment" && input.fidelity !== "high-exp") throw new HubInputError("实验记录须明确标记 high-exp。");
  if (input.source === "MP-DFT" && input.fidelity !== "low-dft") throw new HubInputError("MP计算记录须标记 low-dft。");
  if (!plain(input.values) || !plain(input.units)) throw new HubInputError("values 和 units 必须显式提供，缺值不能填0。");
  const values: HubRecord["values"] = {}, units: HubRecord["units"] = {};
  for (const [key, value] of Object.entries(input.values)) {
    if (!Object.hasOwn(OBJECTIVES, key)) throw new HubInputError(`未知目标：${key}`);
    if (value == null) continue;
    const objective = key as ObjectiveId;
    if (input.units[key] !== OBJECTIVES[objective].unit) throw new HubInputError(`单位不匹配：${key} 应为 ${OBJECTIVES[objective].unit}`);
    values[objective] = finite(value, key); units[objective] = OBJECTIVES[objective].unit;
    if (["energy-above-hull", "band-gap", "bond-energy", "polarization-resistance", "overpotential"].includes(objective) && values[objective]! < 0) throw new HubInputError(`${key} 不得为负；请核对目标定义和符号约定。`);
  }
  if (Object.keys(values).length === 0) throw new HubInputError("记录至少需有一个有限目标值。");
  return { id, formula, composition: parsedComposition, values, units, source: input.source, fidelity: input.fidelity,
    methodMeta: required(input.methodMeta, "methodMeta"), cohort: required(input.cohort, "cohort", 200), provenance,
    structure: checkedStructure(input.structure, id, formula, structureProvenance.retrievedAt, parsedComposition),
    ...(input.structure ? { structureProvenance } : {}), ...(plain(input.symmetry) ? { symmetry: input.symmetry } : {}) };
}
export function validatePair(input: any): FidelityPair {
  if (!plain(input) || typeof input.objective !== "string" || !Object.hasOwn(OBJECTIVES, input.objective)) throw new HubInputError("配对目标无效。");
  const id = identifier(input.id), formula = required(input.formula, "formula", 200), objective = input.objective as ObjectiveId;
  if (input.unit !== OBJECTIVES[objective].unit) throw new HubInputError("配对的单位必须与目标一致。");
  const observation = (value: any, name: string) => {
    if (!plain(value)) throw new HubInputError(`缺少 ${name} 观测。`);
    return { value: finite(value.value, name), methodMeta: required(value.methodMeta, `${name}.methodMeta`), provenance: validateProvenance(value.provenance) };
  };
  const dft = observation(input.dft, "dft"), experiment = observation(input.experiment, "experiment");
  const parsedComposition = composition(input.composition);
  const structureProvenance = input.structureProvenance ? validateProvenance(input.structureProvenance) : dft.provenance;
  if (["energy-above-hull", "band-gap", "bond-energy", "polarization-resistance", "overpotential"].includes(objective) && (dft.value < 0 || experiment.value < 0)) throw new HubInputError("该配对目标使用非负数值约定。");
  return { id, formula, composition: parsedComposition, objective, unit: input.unit, cohort: required(input.cohort, "cohort", 200),
    comparisonBasis: required(input.comparisonBasis, "comparisonBasis", 2000), dft, experiment,
    structure: checkedStructure(input.structure, id, formula, structureProvenance.retrievedAt, parsedComposition),
    ...(input.structure ? { structureProvenance } : {}) };
}
export function elementList(value: unknown): string[] {
  if (value === undefined || value === "") return [];
  if (typeof value !== "string" || value.length > 200) throw new HubInputError("元素筛选必须是逗号分隔的元素符号。");
  const list = [...new Set(value.trim().split(/[\s,]+/).filter(Boolean))];
  if (list.length > 16 || list.some(el => !getElementConstants(el))) throw new HubInputError("存在无效元素符号，或超过16种元素。");
  return list.sort();
}
export function parseHubQuery(input: any): HubQuery {
  const source = input.source ?? "mp-snapshot", objective = input.objective ?? "band-gap";
  if (!["mp-live", "mp-snapshot", "catalysis-hub", "dual-fidelity"].includes(source) || typeof objective !== "string" || !Object.hasOwn(OBJECTIVES, objective)) throw new HubInputError("数据源或优化目标无效。");
  const elements = elementList(input.elements), exclude = elementList(input.exclude_elements);
  if (elements.some(el => exclude.includes(el))) throw new HubInputError("包含与排除元素不能重叠。");
  const match = input.match ?? "contains";
  if (!["contains", "exact"].includes(match) || (match === "exact" && !elements.length)) throw new HubInputError("精确体系需要至少一个包含元素。");
  if (source === "mp-live" && !elements.length) throw new HubInputError("实时查询请先指定至少一个元素。");
  const limit = input.limit === undefined ? 40 : typeof input.limit === "string" && /^\d+$/.test(input.limit) ? Number(input.limit) : NaN;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new HubInputError("Data Hub 每次读取范围为1–500条。");
  const cohort = input.cohort ?? "";
  if (typeof cohort !== "string" || cohort.length > 200) throw new HubInputError("cohort 无效。");
  return { source, objective: objective as ObjectiveId, elements: elements.join(","), excludeElements: exclude.join(","), match, cohort, limit };
}
export function pairRecord(pair: FidelityPair): HubRecord {
  return { id: pair.id, formula: pair.formula, composition: pair.composition, values: { [pair.objective]: pair.experiment.value },
    units: { [pair.objective]: pair.unit }, source: "Lab-Experiment", fidelity: "high-exp", methodMeta: pair.experiment.methodMeta,
    provenance: pair.experiment.provenance, cohort: pair.cohort, comparisonBasis: pair.comparisonBasis,
    structure: pair.structure, structureProvenance: pair.structureProvenance ?? pair.dft.provenance, pairedDft: pair.dft.value };
}
export class HubStore {
  readonly db: any;
  constructor(readonly filename: string) {
    if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 3000");
    this.db.exec(`CREATE TABLE IF NOT EXISTS hub_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO hub_meta VALUES ('schema_version','1');
      CREATE TABLE IF NOT EXISTS mp_snapshot (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mp_snapshot_versions (id TEXT NOT NULL, revision TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id,revision));
      CREATE TABLE IF NOT EXISTS catalysis_records (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dual_fidelity_pairs (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision TEXT NOT NULL, updated_at TEXT NOT NULL);`);
    if (this.db.prepare("SELECT value FROM hub_meta WHERE key='schema_version'").get()?.value !== "1") throw new Error("Unsupported Data Hub schema");
  }
  close() { if (this.db.open) this.db.close(); }
  import(source: StoredHubSource, input: unknown[], allowSnapshotUpdate = false) {
    if (!Array.isArray(input) || input.length < 1 || input.length > 500) throw new HubInputError("一次导入1–500条记录。");
    const rows = input.map(row => source === "dual-fidelity" ? validatePair(row) : validateHubRecord(row));
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new HubInputError("导入批次含重复id。");
    if (source === "mp-snapshot" && rows.some((row: HubRecord) => row.source !== "MP-DFT")) throw new HubInputError("MP快照只能保存注明来源的MP计算记录。");
    const table = tables[source];
    return this.db.transaction(() => {
      const exists = this.db.prepare(`SELECT 1 FROM ${table} WHERE id=?`);
      const put = this.db.prepare(`INSERT INTO ${table}(id,payload,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at`);
      for (const row of rows) {
        if (!(source === "mp-snapshot" && allowSnapshotUpdate) && exists.get(row.id)) throw new HubInputError(`记录ID已存在：${row.id}；请为不同观测使用独立ID。`);
        const payload = JSON.stringify(row), revision = createHash("sha256").update(payload).digest("hex");
        if (source === "mp-snapshot") this.db.prepare("INSERT OR IGNORE INTO mp_snapshot_versions VALUES(?,?,?)").run(row.id, revision, payload);
        put.run(row.id, payload, revision, new Date().toISOString());
      }
      return rows.length;
    })();
  }
  pairs(): FidelityPair[] { return this.db.prepare("SELECT payload FROM dual_fidelity_pairs ORDER BY id").all().map((r: any) => JSON.parse(r.payload)); }
  catalog(): HubCatalog {
    return { sources: (Object.keys(tables) as StoredHubSource[]).map(id => {
      const rows = this.db.prepare(`SELECT payload,updated_at FROM ${tables[id]} ORDER BY id`).all();
      return { id, count: rows.length, updatedAt: rows.length ? rows.map((r: any) => r.updated_at).sort().at(-1) : null,
        cohorts: [...new Set<string>(rows.map((r: any) => JSON.parse(r.payload).cohort))].sort() };
    }) };
  }
  select(source: StoredHubSource, query: HubQuery, onlyIds?: Set<string>) {
    const include = elementList(query.elements), exclude = elementList(query.excludeElements);
    const rows = this.db.prepare(`SELECT payload,revision FROM ${tables[source]} ORDER BY id`).all();
    let missing = 0;
    const selected: HubRecord[] = [];
    const revisions: string[] = [];
    for (const stored of rows) {
      const raw = JSON.parse(stored.payload);
      const row: HubRecord = source === "dual-fidelity" ? pairRecord(raw) : raw;
      if (onlyIds && !onlyIds.has(row.id)) continue;
      const elements = Object.keys(row.composition);
      if (!include.every(el => elements.includes(el)) || exclude.some(el => elements.includes(el))
        || (query.match === "exact" && elements.length !== include.length) || (query.cohort && query.cohort !== row.cohort)) continue;
      if (!Number.isFinite(row.values[query.objective])) { missing++; continue; }
      if (selected.length < query.limit) { selected.push(row); revisions.push(stored.revision); }
    }
    const cohorts = new Set(selected.map(r => r.cohort));
    if ((source === "catalysis-hub" || source === "dual-fidelity") && cohorts.size > 1 && !query.cohort) throw new HubInputError("存在多个测试条件/配对口径，请先选择cohort，避免混合不可比观测。");
    return { data: selected, revisions, excludedMissingTarget: missing,
      datasetVersion: createHash("sha256").update(revisions.join("|")).digest("hex").slice(0, 16),
      fetchedAt: selected.length ? selected.map(r => r.provenance.retrievedAt).sort().at(-1)! : null };
  }
  record(source: StoredHubSource, id: string, revision?: string) {
    let stored = this.db.prepare(`SELECT payload,revision FROM ${tables[source]} WHERE id=?`).get(id);
    if (source === "mp-snapshot" && revision) stored = this.db.prepare("SELECT payload,revision FROM mp_snapshot_versions WHERE id=? AND revision=?").get(id, revision);
    if (!stored || (revision && stored.revision !== revision)) return null;
    const raw = JSON.parse(stored.payload), row: HubRecord = source === "dual-fidelity" ? pairRecord(raw) : raw;
    return { row, structureProvenance: row.structureProvenance ?? row.provenance, revision: stored.revision };
  }
  structure(source: StoredHubSource, id: string, revision?: string) {
    const record = this.record(source, id, revision);
    return record?.row.structure ? record : null;
  }
}
