import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { MPSummaryStore } from "../server/mpSummaryStore";
import { HubStore } from "../server/hubStore";
import { createApiApp } from "../server/api";
import { createNetworkClient } from "../server/network";
import { DEFAULT_HUB_QUERY, type HubRecord } from "../src/dataHub";
import { json, listen } from "./httpFixtures";

function row(id: string, composition: Record<string, number>, gap: number | null, deprecated = false, scale = 1) {
  const species = Object.entries(composition).flatMap(([element, amount]) => Array.from({ length: amount }, () => element));
  const record: HubRecord = { id, formula: id, composition, values: { "formation-energy": -scale, "energy-above-hull": 0, ...(gap === null ? {} : { "band-gap": gap }) },
    units: { "formation-energy": "eV/atom", "energy-above-hull": "eV/atom", ...(gap === null ? {} : { "band-gap": "eV" as const }) },
    source: "MP-DFT", fidelity: "low-dft", methodMeta: "Synthetic contract fixture", cohort: "MP-summary",
    provenance: { reference: "Synthetic contract fixture", url: "https://fixtures.invalid/mp", datasetVersion: `fixture-${scale}`, retrievedAt: "2026-11-01T00:00:00Z", license: "test-only" },
    structure: { lattice: { matrix: [[3*scale, 0, 0], [0, 3*scale, 0], [0, 0, 3*scale]] },
      sites: species.map((element, i) => ({ species: [{ element, occu: 1 }], abc: [i/species.length, 0, 0] })) } };
  return { record, gap, deprecated };
}

function fixture(t: TestContext, scale = 1) {
  const dir = mkdtempSync(join(tmpdir(), "ai4s-mp-summary-")), filename = join(dir, "summary.sqlite");
  const db = new Database(filename);
  db.exec(`CREATE TABLE mirror_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE materials(id TEXT PRIMARY KEY,formula TEXT,chemical_system TEXT,band_gap REAL,formation_energy REAL,energy_above_hull REAL,deprecated INTEGER,payload TEXT);
    CREATE TABLE material_elements(element TEXT,material_id TEXT,PRIMARY KEY(element,material_id));`);
  const rows = [row("mp-a", { Li: 2, O: 1 }, 0, false, scale), row("mp-b", { Li: 1, Fe: 1, O: 2 }, 2),
    row("mp-c", { Li: 3, N: 1 }, null), row("mp-d", { Sr: 1, Ti: 1, O: 3 }, 3), row("mp-retired", { Li: 2, O: 1 }, 99, true)];
  for (const { record, gap, deprecated } of rows) {
    db.prepare("INSERT INTO materials VALUES(?,?,?,?,?,?,?,?)").run(record.id, record.formula, Object.keys(record.composition).sort().join("-"), gap, record.values["formation-energy"], 0, +deprecated, JSON.stringify(record));
    for (const element of Object.keys(record.composition)) db.prepare("INSERT INTO material_elements VALUES(?,?)").run(element, record.id);
  }
  db.prepare("INSERT INTO mirror_meta VALUES('manifest',?)").run(JSON.stringify({ format: "ai4s-mp-summary-1", version: "2026-09-28", sha256: "a".repeat(64), sourceURL: "https://fixtures.invalid/summary", downloadedAt: "2026-11-01T00:00:00Z", sourceRecords: 5, indexedRecords: 5, activeRecords: 4 }));
  db.close();
  const mirror = new MPSummaryStore(filename);
  t.after(() => { mirror.close(); rmSync(dir, { recursive: true, force: true }); });
  return mirror;
}

test("full Summary queries preserve zero, missing values, exact systems, exclusions and bounded counts", t => {
  const mirror = fixture(t);
  const result = mirror.select({ ...DEFAULT_HUB_QUERY, elements: "Li", limit: 1 });
  assert.equal(result.records.length, 1); assert.equal(result.records[0].id, "mp-a");
  assert.equal(result.records[0].values["band-gap"], 0); assert.equal(result.matchedTotal, 2); assert.equal(result.excludedMissingTarget, 1);
  assert.deepEqual(mirror.select({ ...DEFAULT_HUB_QUERY, elements: "O,Li", match: "exact" }).records.map(r => r.id), ["mp-a"]);
  assert.deepEqual(mirror.select({ ...DEFAULT_HUB_QUERY, elements: "Li", excludeElements: "Fe" }).records.map(r => r.id), ["mp-a"]);
  assert.equal(mirror.select({ ...DEFAULT_HUB_QUERY, elements: "Li", objective: "formation-energy" }).matchedTotal, 3);
  assert.equal(mirror.select({ ...DEFAULT_HUB_QUERY, cohort: "MP-summary' OR 1=1 --" }).matchedTotal, 0);
  assert.throws(() => mirror.select({ ...DEFAULT_HUB_QUERY, limit: 5001 }));
  assert.throws(() => mirror.db.exec("DELETE FROM materials"));
  assert.equal(mirror.catalogEntry().count, 4); assert.equal(mirror.catalogEntry().rawCount, 5);
});

test("offline mirror queries never call upstream and retain exact cached structure versions", async t => {
  const mirror = fixture(t), updated = fixture(t, 2), hub = new HubStore(":memory:"); t.after(() => hub.close());
  let upstreamCalls = 0;
  const upstream = await listen(t, http.createServer((_req, res) => { upstreamCalls++; json(res, { data: [] }); }));
  const network = createNetworkClient({ proxyResolver: () => "" }); t.after(() => network.close());
  const a = await listen(t, http.createServer(createApiApp({ network, hub, mpSummary: mirror, env: {}, materialsEndpoint: upstream })));
  const b = await listen(t, http.createServer(createApiApp({ network, hub, mpSummary: updated, env: {}, materialsEndpoint: upstream })));
  const path = "/api/hub/materials?source=mp-snapshot&elements=Li,O&match=exact&limit=1";
  const first = await (await fetch(a+path)).json();
  assert.equal(first.meta.matchedTotal, 1); assert.equal(first.data.length, 1); assert.equal(first.meta.total, 1);
  const again = await (await fetch(a+path)).json(); assert.equal(first.data[0].revision, again.data[0].revision);
  const changed = await (await fetch(b+path)).json(); assert.notEqual(changed.data[0].revision, first.data[0].revision);
  const refs = [{ dataset: "mp-snapshot", id: "mp-a", revision: first.data[0].revision }];
  const restored = await (await fetch(b+"/api/hub/records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refs }) })).json();
  assert.equal(restored.data[0].values["formation-energy"], -1);
  const geometry = await (await fetch(b+`/api/hub/structure?dataset=mp-snapshot&id=mp-a&revision=${refs[0].revision}`)).json();
  assert.equal(geometry.data.structure.lattice.matrix[0][0], 3);
  const empty = await (await fetch(a+"/api/hub/materials?source=mp-snapshot&elements=Au&limit=5")).json(); assert.deepEqual(empty.data, []);
  const imported = await (await fetch(a+"/api/hub/import", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataset: "catalysis-hub", records: [{ ...mirror.select(DEFAULT_HUB_QUERY).records[0], id: "fixture-catalyst", source: "Catalysis-Hub" }] }) })).json();
  const catalog = imported.catalog.sources.find((entry: { id: string }) => entry.id === "mp-snapshot");
  assert.equal(catalog.count, 4); assert.equal(catalog.provider, "mp-summary-mirror");
  assert.equal(upstreamCalls, 0);
});

test("a successful live query remains independent of full offline mirror results", async t => {
  const mirror = fixture(t), hub = new HubStore(":memory:"); t.after(() => hub.close());
  const upstream = await listen(t, http.createServer((_req, res) => json(res, { data: [{ material_id: "mp-live-only", formula_pretty: "Li2O", composition: { Li: 2, O: 1 }, band_gap: 4 }], meta: { db_version: "live-fixture" } })));
  const network = createNetworkClient({ proxyResolver: () => "" }); t.after(() => network.close());
  const base = await listen(t, http.createServer(createApiApp({ network, hub, mpSummary: mirror, env: { MP_API_KEY: "test-only" }, materialsEndpoint: upstream })));
  const data = await (await fetch(base+"/api/hub/materials?source=mp-live&elements=Li&limit=3")).json();
  assert.equal(data.meta.effectiveSource, "mp-live"); assert.deepEqual(data.data.map((r: HubRecord) => r.id), ["mp-live-only"]);
});
