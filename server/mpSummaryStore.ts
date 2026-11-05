import Database from "better-sqlite3";
import { MAX_HUB_CANDIDATES, type HubCatalog, type HubQuery, type HubRecord } from "../src/dataHub";
import { elementList, HubInputError } from "./hubStore";

const columns = { "band-gap": "band_gap", "formation-energy": "formation_energy", "energy-above-hull": "energy_above_hull" } as const;
export interface SummaryManifest {
  format: "ai4s-mp-summary-1"; version: string; sourceURL: string; sha256: string; downloadedAt: string;
  sourceRecords: number; indexedRecords: number; activeRecords: number; deprecatedRecords: number;
  activeStructures: number; rejectedRecords?: number;
}

/** Read-only full collection. Only the bounded result set is decoded into JS objects. */
export class MPSummaryStore {
  readonly db: any;
  readonly manifest: SummaryManifest;
  constructor(readonly filename: string) {
    this.db = new Database(filename, { readonly: true, fileMustExist: true });
    this.db.pragma("query_only = ON");
    this.db.pragma("cache_size = -4096");
    try {
      this.manifest = JSON.parse(this.db.prepare("SELECT value FROM mirror_meta WHERE key='manifest'").get()?.value);
      if (this.manifest.format !== "ai4s-mp-summary-1" || !/^\d{4}-\d{2}-\d{2}$/.test(this.manifest.version)
        || !/^[a-f0-9]{64}$/.test(this.manifest.sha256) || !Number.isFinite(Date.parse(this.manifest.downloadedAt))
        || ![this.manifest.sourceRecords, this.manifest.indexedRecords, this.manifest.activeRecords].every(n => Number.isSafeInteger(n) && n >= 0)) throw new Error();
    } catch { this.db.close(); throw new Error("Invalid MP Summary index manifest"); }
  }
  close() { if (this.db.open) this.db.close(); }
  catalogEntry(): HubCatalog["sources"][number] {
    return { id: "mp-snapshot", count: this.manifest.activeRecords, updatedAt: this.manifest.downloadedAt,
      cohorts: ["MP-summary"], provider: "mp-summary-mirror", datasetVersion: this.manifest.version, rawCount: this.manifest.sourceRecords,
      snapshotSha256: this.manifest.sha256, sourceURL: this.manifest.sourceURL };
  }
  select(query: HubQuery) {
    if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > MAX_HUB_CANDIDATES || !["contains", "exact"].includes(query.match)) throw new HubInputError("Summary 查询每次载入1–5000条。 / Choose 1–5000 candidates.");
    const include = elementList(query.elements), exclude = elementList(query.excludeElements);
    if (query.match === "exact" && !include.length) throw new HubInputError("精确体系需要包含元素。");
    if (include.some(el => exclude.includes(el))) throw new HubInputError("包含与排除元素不能重叠。");
    const where = ["m.deprecated=0"], params: (string | number)[] = [];
    if (query.cohort) { where.push("?='MP-summary'"); params.push(query.cohort); }
    if (query.match === "exact") { where.push("m.chemical_system=?"); params.push(include.join("-")); }
    else if (include.length) {
      where.push(`m.id IN (SELECT material_id FROM material_elements WHERE element IN (${include.map(() => "?").join(",")}) GROUP BY material_id HAVING COUNT(*)=?)`);
      params.push(...include, include.length);
    }
    if (exclude.length) {
      where.push(`m.id NOT IN (SELECT material_id FROM material_elements WHERE element IN (${exclude.map(() => "?").join(",")}))`);
      params.push(...exclude);
    }
    const clause = where.join(" AND ");
    const column = columns[query.objective as keyof typeof columns];
    const counts = this.db.prepare(`SELECT COUNT(*) AS total, ${column ? `COUNT(m.${column})` : "0"} AS eligible FROM materials m WHERE ${clause}`).get(...params);
    const records: HubRecord[] = column ? this.db.prepare(`SELECT m.payload FROM materials m WHERE ${clause} AND m.${column} IS NOT NULL ORDER BY m.id LIMIT ?`)
      .all(...params, query.limit).map((row: { payload: string }) => JSON.parse(row.payload)) : [];
    return { records, matchedTotal: counts.eligible as number, excludedMissingTarget: (counts.total - counts.eligible) as number };
  }
}
