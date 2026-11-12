import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { learningBenchmark } from "../src/research/benchmark";
import { hydrateHubMaterials } from "../src/engine/MaterialsEngine";
import { validatePresentationPreset } from "../src/demo/presentation";
import { compositionGroup } from "../src/engine/distillation/features";
import { OBJECTIVES, type HubResponse, type ObjectiveId } from "../src/dataHub";
const args = process.argv.slice(2), option = (name: string) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const input = option("--input"), usePreset = args.includes("--preset"), output = option("--output");
if (!!input === usePreset) throw new Error("Choose --input <HubResponse.json> OR --preset. No synthetic fallback.");
const path = input ?? new URL("../src/demo/presentation-preset.json", import.meta.url);
const raw = readFileSync(path, "utf8"), payload = JSON.parse(raw), objective = (option("--objective") ?? "band-gap") as ObjectiveId;
if (!Object.hasOwn(OBJECTIVES, objective) || usePreset && objective !== "band-gap") throw new Error("Choose a supported objective; the preset supplies band-gap labels.");
const response = payload as HubResponse;
if (!usePreset && (!response.meta || response.meta.objective !== objective || !Array.isArray(response.data))) throw new Error("Input must be an original Data Hub response for this objective.");
const pool = usePreset ? validatePresentationPreset(payload).learning.pool : await hydrateHubMaterials(response.data, response.meta);
const count = Number(option("--seeds") ?? 20), budget = Number(option("--budget") ?? 50);
if (!Number.isSafeInteger(count) || count < 2 || count > 100) throw new Error("--seeds must be 2–100.");
const formula = option("--rediscover-formula"), id = option("--rediscover-id");
const matching = pool.filter(m => id ? m.id === id : formula ? m.formula === formula : false);
if ((formula || id) && !matching.length) throw new Error("Requested rediscovery material is absent. Supply a sourced candidate set containing it.");
const held = matching.length ? pool.filter(m => compositionGroup(m.composition) === compositionGroup(matching[0].composition)).map(m => m.id) : [];
const result = await learningBenchmark(pool, { seeds: Array.from({ length: count }, (_, i) => 101 + i), budget, objective,
  ...(option("--target") ? { targetValue: Number(option("--target")) } : {}), rediscoverIds: held });
const document = { ...result, inputSha256: createHash("sha256").update(raw).digest("hex"),
  sourceVersion: usePreset ? payload.provenance : response.meta, generatedAt: new Date().toISOString() };
const json = JSON.stringify(document, null, 2) + "\n";
if (output) writeFileSync(output, json); else process.stdout.write(json);
console.error(JSON.stringify({ candidateCount: result.candidateCount, seeds: count, ai: result.ai, random: result.random, output: output ?? "stdout" }));
