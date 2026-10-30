import { SurrogateModel } from "../SurrogateModel";
import { hashString } from "../SeededRandom";
import { targetSpec } from "../../materialContext";
import { PHYSICAL_FEATURES } from "./features";
import { splitCompositionGroups } from "./partitions";
export { splitCompositionGroups } from "./partitions";
import { dimensionText, evaluateExpression, expressionDepth, expressionDimension, expressionKey, expressionSize, formatExpression } from "./expressions";
import { DEFAULT_DISTILLATION_OPTIONS, type DistillationOptions, type DistillationResult, type DistillationSnapshot,
  type Expression, type Metrics, type QueryPoint, type SamplePoint } from "./types";

interface FitRow extends QueryPoint { target: number }
interface Candidate { expression: Expression; values: number[]; correlation: number; complexity: number; key: string }
interface Fit { intercept: number; coefficients: number[] }

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const weightsFor = (rows: { group: string }[]) => {
  const counts = new Map<string, number>();
  rows.forEach(row => counts.set(row.group, (counts.get(row.group) ?? 0) + 1));
  return rows.map(row => 1 / counts.get(row.group)!);
};
const average = (values: number[], weights: number[]) => sum(values.map((value, i) => value * weights[i])) / sum(weights);
const variance = (values: number[], weights: number[]) => {
  const center = average(values, weights);
  return average(values.map(value => (value - center) ** 2), weights);
};
const correlation = (a: number[], b: number[], weights: number[]) => {
  const ca = average(a, weights), cb = average(b, weights);
  const denominator = Math.sqrt(variance(a, weights) * variance(b, weights));
  return denominator > 1e-16 ? average(a.map((value, i) => (value - ca) * (b[i] - cb)), weights) / denominator : 0;
};

/** Weighted centered OLS, rejecting singular one/two-term designs. */
export function fitSparseLinear(columns: number[][], y: number[], weights = y.map(() => 1)): Fit | null {
  if (!columns.length || columns.length > 2 || columns.some(column => column.length !== y.length) || y.length < columns.length + 2) return null;
  const centers = columns.map(column => average(column, weights)), centerY = average(y, weights);
  const centered = columns.map((column, j) => column.map(value => value - centers[j]));
  const yy = y.map(value => value - centerY);
  const a = centered.map(column => average(column.map(value => value ** 2), weights));
  const b = centered.map(column => average(column.map((value, i) => value * yy[i]), weights));
  if (a.some(value => value <= 1e-24)) return null;
  let coefficients: number[];
  if (columns.length === 1) coefficients = [b[0] / a[0]];
  else {
    const cross = average(centered[0].map((value, i) => value * centered[1][i]), weights);
    const determinant = a[0] * a[1] - cross ** 2;
    if (determinant <= 1e-8 * a[0] * a[1]) return null;
    coefficients = [(b[0] * a[1] - b[1] * cross) / determinant, (b[1] * a[0] - b[0] * cross) / determinant];
  }
  const intercept = centerY - sum(coefficients.map((value, i) => value * centers[i]));
  return [intercept, ...coefficients].every(Number.isFinite) ? { intercept, coefficients } : null;
}

/** min ||y-b-Xβ||²/(2 sum(w)) + λ||β||₁, with training-only standardized X. */
export function lassoCoefficients(columns: number[][], y: number[], lambda: number, weights = y.map(() => 1)): number[] {
  const centers = columns.map(column => average(column, weights));
  const scales = columns.map(column => Math.sqrt(variance(column, weights)) || 1);
  const X = columns.map((column, j) => column.map(value => (value - centers[j]) / scales[j]));
  const residual = y.map(value => value - average(y, weights)), beta = columns.map(() => 0);
  for (let step = 0; step < 100; step++) {
    let maximum = 0;
    for (let j = 0; j < X.length; j++) {
      const old = beta[j];
      residual.forEach((_, i) => { residual[i] += old * X[j][i]; });
      const rho = average(X[j].map((value, i) => value * residual[i]), weights);
      beta[j] = Math.sign(rho) * Math.max(0, Math.abs(rho) - lambda);
      residual.forEach((_, i) => { residual[i] -= beta[j] * X[j][i]; });
      maximum = Math.max(maximum, Math.abs(beta[j] - old));
    }
    if (maximum < 1e-8) break;
  }
  return beta.map((value, j) => value / scales[j]);
}

function metrics(rows: QueryPoint[], targets: number[], predictions: (number | null)[]): Metrics {
  const valid = rows.map((row, i) => ({ row, target: targets[i], prediction: predictions[i] }))
    .filter((entry): entry is { row: QueryPoint; target: number; prediction: number } => entry.prediction !== null && Number.isFinite(entry.prediction));
  if (!valid.length) return { count: 0, groups: 0, invalid: rows.length, mae: null, rmse: null, r2: null };
  const weights = weightsFor(valid.map(entry => entry.row)), y = valid.map(entry => entry.target);
  const errors = valid.map(entry => entry.prediction - entry.target);
  const mse = average(errors.map(value => value ** 2), weights), v = variance(y, weights);
  return { count: valid.length, groups: new Set(valid.map(entry => entry.row.group)).size,
    invalid: rows.length - valid.length, mae: average(errors.map(Math.abs), weights), rmse: Math.sqrt(mse), r2: v > 1e-16 ? 1 - mse / v : null };
}
function predict(fit: Fit, expressions: Expression[], row: QueryPoint): number | null {
  const values = expressions.map(expression => evaluateExpression(expression, row.values));
  if (values.some(value => value === null)) return null;
  const value = fit.intercept + sum(values.map((value, i) => value! * fit.coefficients[i]));
  return Number.isFinite(value) ? value : null;
}

export async function searchPhysicalFormulas(snapshot: DistillationSnapshot, input: Partial<DistillationOptions> = {}): Promise<DistillationResult> {
  const started = performance.now(), options = { ...DEFAULT_DISTILLATION_OPTIONS, ...snapshot.searchOptions, ...input };
  for (const [key, lo, hi] of [["minSamples", 8, 200], ["maxCandidates", 100, 12000], ["maxDepth", 2, 5], ["maxNodes", 3, 15]] as const) {
    if (!Number.isInteger(options[key]) || options[key] < lo || options[key] > hi) throw new RangeError("无效搜索限制：" + key);
  }
  if (![options.l0, options.l1].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) throw new RangeError("正则化强度须在 0–1");
  if (!Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff) throw new RangeError("无效搜索种子");
  if (snapshot.samples.length < options.minSamples) throw new Error("至少采样 " + options.minSamples + " 条记录后开始搜索");
  if (snapshot.samples.length > 1024 || snapshot.queries.length > 20000) throw new RangeError("超过公式搜索规模上限");
  if (snapshot.samples.some(row => !Number.isFinite(row.label))) throw new Error("已采样性质无效");
  const calibrationGroups = snapshot.samples.filter(row => snapshot.calibration?.calibrationIds.includes(row.id)).map(row => row.group);
  const split = splitCompositionGroups(snapshot.samples, options.seed, snapshot.partitions, calibrationGroups);
  const partition = (name: keyof typeof split) => snapshot.samples.filter(row => split[name].includes(row.group));
  const discovery = partition("discovery"), tuning = partition("tuning"), test = partition("test");
  const teacherData = snapshot.target === "teacher" ? discovery : [...discovery, ...tuning];
  const teacher = new SurrogateModel(snapshot.modelConfig);
  // The teacher never sees the test groups. In distillation mode it also never sees tuning labels.
  await teacher.train(teacherData.map(row => ({ features: row.features, trueProperty: snapshot.calibration ? row.pairedDft! : row.label })));
  const teacherPrediction = (row: { features: number[] }) => (() => { const prediction = teacher.predict(row); return { ...prediction, mean: prediction.mean + (snapshot.calibration?.correction ?? 0) }; })();
  const targetFor = (row: SamplePoint) => snapshot.target === "teacher" ? teacherPrediction(row).mean : row.label;
  const discoveryTargets = discovery.map(targetFor), discoveryWeights = weightsFor(discovery);
  const excludedFeatures: DistillationResult["excludedFeatures"] = [];
  const base = PHYSICAL_FEATURES.map((feature, index) => {
    const values = discovery.map(row => row.values[index]);
    if (values.some(value => value === null || !Number.isFinite(value))) {
      excludedFeatures.push({ id: feature.id, reason: "发现集缺值；未用零代替" }); return null;
    }
    if (variance(values as number[], discoveryWeights) < 1e-20) {
      excludedFeatures.push({ id: feature.id, reason: "发现集中为常量" }); return null;
    }
    return { index, score: Math.abs(correlation(values as number[], discoveryTargets, discoveryWeights)) };
  }).filter((value): value is { index: number; score: number } => value !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 8);
  if (base.length < 2) throw new Error("完整且有变化的物理特征不足两项");
  let fitRows: FitRow[];
  if (snapshot.target === "teacher") {
    const forbidden = new Set([...split.tuning, ...split.test]);
    const queries = snapshot.queries.filter(row => !forbidden.has(row.group) && base.every(feature => row.values[feature.index] !== null))
      .sort((a, b) => hashString(a.id) - hashString(b.id)).slice(0, 600);
    fitRows = queries.map(row => ({ ...row, target: teacherPrediction(row).mean }));
  } else fitRows = discovery.map(row => ({ ...row, target: row.label }));
  if (fitRows.length < 4) throw new Error("可用于符号搜索的完整记录不足四条");
  const y = fitRows.map(row => row.target), weights = weightsFor(fitRows), targetVariance = variance(y, weights);
  if (targetVariance < 1e-16) throw new Error("当前训练目标几乎不变，无法识别有意义的公式");
  const candidates: Candidate[] = [], keys = new Set<string>(), signatures = new Set<string>();
  let evaluated = 0;
  const add = (expression: Expression) => {
    const key = expressionKey(expression), dimension = expressionDimension(expression, PHYSICAL_FEATURES);
    if (evaluated >= options.maxCandidates || keys.has(key) || !dimension || dimension.some(value => Math.abs(value) > 4)
      || expressionSize(expression) > options.maxNodes || expressionDepth(expression) > options.maxDepth) return;
    keys.add(key); evaluated++;
    const values = fitRows.map(row => evaluateExpression(expression, row.values));
    if (values.some(value => value === null)) return;
    const v = values as number[], center = average(v, weights), scale = Math.sqrt(variance(v, weights));
    if (scale < 1e-12) return;
    const sign = (v.find(value => Math.abs(value - center) > scale * 1e-6) ?? center) >= center ? 1 : -1;
    const signature = v.map(value => Math.round((value - center) / scale * sign * 1e7)).join(",");
    if (signatures.has(signature)) return;
    signatures.add(signature);
    candidates.push({ expression, values: v, correlation: Math.abs(correlation(v, y, weights)), complexity: expressionSize(expression), key });
  };
  const leaves: Expression[] = base.map(feature => ({ op: "variable", index: feature.index }));
  leaves.forEach(add);
  for (let depth = 2; depth <= options.maxDepth && evaluated < options.maxCandidates; depth++) {
    const beam = candidates.slice().sort((a, b) => (b.correlation - 0.002 * b.complexity) - (a.correlation - 0.002 * a.complexity) || a.key.localeCompare(b.key)).slice(0, 14);
    const parents = [...leaves, ...beam.map(candidate => candidate.expression), { op: "one" as const }];
    const boundary = Math.min(options.maxCandidates, evaluated + Math.ceil(options.maxCandidates / (options.maxDepth - 1)));
    for (const parent of parents) {
      for (const op of ["abs", "sqrt", "exp"] as const) add({ op, arg: parent });
      for (const other of parents) {
        for (const op of ["+", "-", "*", "/"] as const) {
          if ((op === "+" || op === "*") && expressionKey(parent) > expressionKey(other)) continue;
          const floor = op === "/" ? Math.max(1e-12, Math.sqrt(average(fitRows.map(row => (evaluateExpression(other, row.values) ?? 0) ** 2), weights)) * 1e-8) : undefined;
          add({ op, left: parent, right: other, ...(floor ? { floor } : {}) });
          if (evaluated >= boundary) break;
        }
        if (evaluated >= boundary) break;
      }
      if (evaluated >= boundary) break;
    }
  }
  const screened = candidates.sort((a, b) => b.correlation - a.correlation || a.complexity - b.complexity || a.key.localeCompare(b.key)).slice(0, 64);
  if (!screened.length) throw new Error("未找到定义域内有变化的候选表达式");
  const lasso = lassoCoefficients(screened.map(candidate => candidate.values), y, options.l1 * Math.sqrt(targetVariance), weights);
  const sparse = screened.map((candidate, i) => ({ candidate, importance: Math.abs(lasso[i]) * Math.sqrt(variance(candidate.values, weights)) }))
    .sort((a, b) => b.importance - a.importance || b.candidate.correlation - a.candidate.correlation);
  // SIS fallback is explicit when L1 shrinks every coefficient to zero.
  const l1Selected = sparse.filter(value => value.importance > 1e-8).length;
  const retained = (l1Selected ? sparse.filter(value => value.importance > 1e-8) : sparse).slice(0, 12).map(value => value.candidate);
  const tuningTargets = tuning.map(targetFor);
  const models: { terms: Candidate[]; fit: Fit; complexity: number; score: number; tuningRmse: number }[] = [];
  const consider = (terms: Candidate[]) => {
    const fit = fitSparseLinear(terms.map(term => term.values), y, weights);
    if (!fit) return;
    const validation = metrics(tuning, tuningTargets, tuning.map(row => predict(fit, terms.map(term => term.expression), row)));
    if (validation.invalid || validation.rmse === null) return;
    const complexity = sum(terms.map(term => term.complexity));
    const score = validation.rmse ** 2 / targetVariance + options.l0 * (terms.length + complexity / 5);
    models.push({ terms, fit, complexity, score, tuningRmse: validation.rmse });
  };
  retained.forEach((a, i) => {
    consider([a]);
    retained.slice(i + 1).forEach(b => consider([a, b]));
  });
  models.sort((a, b) => a.score - b.score || a.complexity - b.complexity);
  if (!models.length) throw new Error("候选公式在验证组缺值或退化；请补充数据后重试");
  const best = models[0], expressions = best.terms.map(term => term.expression);
  const refitRows: FitRow[] = [...fitRows, ...tuning.map(row => ({ ...row, target: targetFor(row) }))];
  const refit = fitSparseLinear(expressions.map(expression => refitRows.map(row => evaluateExpression(expression, row.values)!)),
    refitRows.map(row => row.target), weightsFor(refitRows)) ?? best.fit;
  // The test labels are first used here, after expressions and coefficients have been frozen.
  const truth = test.map(row => row.label), teacherPredictions = test.map(row => teacherPrediction(row).mean);
  const predictions = test.map(row => predict(refit, expressions, row));
  const samePopulation = (values: number[]) => values.map((value, i) => predictions[i] === null ? null : value);
  const baselineRows = snapshot.target === "teacher" ? discovery : [...discovery, ...tuning];
  const meanTarget = average(baselineRows.map(row => row.label), weightsFor(baselineRows));
  const ridge = new SurrogateModel({ kind: "ridge", seed: options.seed });
  await ridge.train(baselineRows.map(row => ({ features: row.features, trueProperty: row.label })));
  const sampled = new Map(snapshot.samples.map(row => [row.id, row.label]));
  const second = expressions[1] ?? retained.find(candidate => candidate.key !== best.terms[0].key
    && Math.abs(correlation(candidate.values, best.terms[0].values, weights)) < 0.98)?.expression;
  const axes = [expressions[0], second].filter((expression): expression is Expression => Boolean(expression));
  const points: DistillationResult["points"] = [];
  let invalidProjection = 0;
  for (const row of snapshot.queries) {
    const x = evaluateExpression(axes[0], row.values), yy = axes[1] ? evaluateExpression(axes[1], row.values) : 0;
    const prediction = predict(refit, expressions, row);
    if (x === null || yy === null || prediction === null) { invalidProjection++; continue; }
    points.push({ id: row.id, formula: row.formula, group: row.group, x, y: yy, prediction, observed: sampled.get(row.id) ?? null,
      partition: split.test.includes(row.group) ? "test" : split.tuning.includes(row.group) ? "tuning" : split.discovery.includes(row.group) ? "discovery" : "candidate" });
  }
  const observed = snapshot.samples.map(row => row.label).sort((a, b) => a - b);
  return {
    formatVersion: "ai4s-formula-result-1",
    computationId: snapshot.id + "-" + hashString(JSON.stringify(options)).toString(16),
    featureDictionary: PHYSICAL_FEATURES.map(feature => ({ ...feature, dimension: [...feature.dimension] as [number, number] })),
    featureSchemaVersion: snapshot.featureSchemaVersion, elementTableVersion: snapshot.elementTableVersion,
    modelConfig: { ...snapshot.modelConfig }, searchOptions: { ...options }, sourceSnapshot: snapshot,
    snapshotId: snapshot.id, runId: snapshot.runId, iteration: snapshot.iteration, target: snapshot.target, objective: snapshot.objective,
    modelKind: snapshot.modelConfig.kind, sampledRecords: snapshot.samples.length, uniqueGroups: new Set(snapshot.samples.map(row => row.group)).size,
    split, splitRecords: { discovery: discovery.length, tuning: tuning.length, test: test.length },
    teacherTrainingRecords: teacherData.length, pseudoRecords: snapshot.target === "teacher" ? fitRows.length : 0,
    formulas: best.terms.map((term, i) => ({
      expression: term.expression, text: formatExpression(term.expression, PHYSICAL_FEATURES),
      latex: formatExpression(term.expression, PHYSICAL_FEATURES, true),
      unit: dimensionText(expressionDimension(term.expression, PHYSICAL_FEATURES)!), coefficient: refit.coefficients[i], complexity: term.complexity,
    })),
    intercept: refit.intercept,
    axes: axes.map((expression, i) => ({ expression, text: formatExpression(expression, PHYSICAL_FEATURES),
      unit: dimensionText(expressionDimension(expression, PHYSICAL_FEATURES)!), auxiliary: i >= expressions.length })),
    metrics: metrics(test, truth, predictions), teacherMetrics: metrics(test, truth, samePopulation(teacherPredictions)),
    fidelity: snapshot.target === "teacher" ? metrics(test, teacherPredictions, predictions) : null,
    meanBaseline: metrics(test, truth, samePopulation(test.map(() => meanTarget))),
    ridgeBaseline: metrics(test, truth, samePopulation(test.map(row => ridge.predict(row).mean))),
    evaluatedCandidates: evaluated, l1Selected, searchMs: performance.now() - started, excludedFeatures,
    alternatives: models.map(model => ({ complexity: model.complexity, tuningRmse: model.tuningRmse })),
    points, invalidProjection, highThreshold: observed[Math.floor((observed.length - 1) * (targetSpec(snapshot.objective).direction === "min" ? 0.2 : 0.8))],
  };
}
