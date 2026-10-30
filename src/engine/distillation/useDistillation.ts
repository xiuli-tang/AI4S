import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Material } from "../../types";
import type { ModelConfig } from "../models/config";
import { targetSpec, type TargetKind } from "../../materialContext";
import { buildDistillationSnapshot, compositionGroup } from "./features";
import { DistillationWorkerClient } from "./DistillationWorkerClient";
import { freezePartitions, splitCompositionGroups } from "./partitions";
import { DEFAULT_DISTILLATION_OPTIONS, type DistillationResult, type DistillationTarget, type PartitionAssignments, type Supplements } from "./types";
import type { Restore, FormulaArchive } from "../../research/types";
import type { CalibrationResult } from "../../dataHub";

export function useDistillation(input: { pool: Material[]; runId: number; iteration: number; isRealData: boolean;
  objective?: TargetKind; modelConfig: ModelConfig; isRunning: boolean; loading: boolean;
  restored?: Restore<FormulaArchive>; onState?(state: FormulaArchive): void; calibration?: CalibrationResult | null }) {
  const objective = input.objective ?? (input.isRealData ? "band-gap" : "synthetic-score");
  const [options, setOptions] = useState({ ...DEFAULT_DISTILLATION_OPTIONS });
  const [target, setTarget] = useState<DistillationTarget>("observed");
  const [supplements, commitSupplements] = useState<Supplements>({});
  const [supplementDraft, setSupplementDraft] = useState("{}");
  const setSupplements = useCallback((value: Supplements) => { commitSupplements(value); setSupplementDraft(JSON.stringify(value, null, 2)); }, []);
  const [automatic, setAutomatic] = useState(true);
  const [result, setResult] = useState<DistillationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cancelled, setCancelled] = useState(false);
  const client = useRef<DistillationWorkerClient | null>(null);
  const serial = useRef(0), lastRequested = useRef(0);
  const partitions = useRef<PartitionAssignments>({});
  const partitionIdentity = JSON.stringify([input.runId, objective, options.seed]);
  const identity = JSON.stringify([input.runId, objective, input.modelConfig, options, target, supplements, input.calibration]);
  const identityRef = useRef(identity); identityRef.current = identity;
  const sampled = useMemo(() => input.pool.filter(material => material.isSampled), [input.pool]);
  const materialIds = useMemo(() => new Set(input.pool.map(material => material.id)), [input.pool]);
  const groups = useMemo(() => new Set(sampled.map(material => compositionGroup(material.composition))).size, [sampled]);

  const appliedRestore = useRef(0), restoredIdentity = useRef("");
  const lastDataset = useRef(JSON.stringify([input.runId, objective])), lastPartition = useRef(partitionIdentity);
  useEffect(() => {
    serial.current++; client.current?.cancel(); setBusy(false); setError(null); setCancelled(false);
    if (input.restored && input.restored.token !== appliedRestore.current) {
      const s = input.restored.value; appliedRestore.current = input.restored.token;
      restoredIdentity.current = JSON.stringify([input.runId, objective, input.modelConfig, s.options, s.target, s.supplements, input.calibration]);
      lastDataset.current = JSON.stringify([input.runId, objective]); lastPartition.current = JSON.stringify([input.runId, objective, s.options.seed]);
      setOptions(s.options); setTarget(s.target); commitSupplements(s.supplements); setSupplementDraft(s.draftText ?? JSON.stringify(s.supplements, null, 2)); setAutomatic(s.automatic); setResult(s.result);
      partitions.current = s.partitions; lastRequested.current = s.result?.sourceSnapshot.samples.length ?? 0;
    } else if (identity === restoredIdentity.current) { restoredIdentity.current = ""; }
    else {
      lastRequested.current = 0; setResult(null);
      const dataset = JSON.stringify([input.runId, objective]);
      if (lastDataset.current !== dataset) { setSupplements({}); lastDataset.current = dataset; }
      if (lastPartition.current !== partitionIdentity) { partitions.current = {}; lastPartition.current = partitionIdentity; }
    }
    return () => { serial.current++; client.current?.dispose(); };
  }, [identity, input.restored?.token]);
  useEffect(() => { input.onState?.({ options, target, supplements, automatic, result, partitions: { ...partitions.current }, lastRequested: lastRequested.current, draftText: supplementDraft }); },
    [options, target, supplements, automatic, result, busy, supplementDraft]);

  const run = useCallback(async () => {
    if (busy || input.loading || sampled.length < options.minSamples || groups < 8) return;
    const request = ++serial.current, capturedIdentity = identity;
    lastRequested.current = sampled.length;
    setBusy(true); setError(null); setCancelled(false);
    try {
      const calibrationGroups = sampled.filter(m => input.calibration?.calibrationIds.includes(m.id)).map(m => compositionGroup(m.composition));
      partitions.current = freezePartitions(splitCompositionGroups(sampled.map(material => ({ group: compositionGroup(material.composition) })), options.seed, partitions.current, calibrationGroups));
      const snapshot = buildDistillationSnapshot(input.pool, { runId: input.runId, iteration: input.iteration,
        target, objective, modelConfig: input.modelConfig, supplements,
        partitions: partitions.current, searchOptions: options, ...(input.calibration ? { calibration: input.calibration } : {}) });
      if (!client.current) client.current = new DistillationWorkerClient();
      const response = await client.current.run(snapshot, options);
      if (request === serial.current && identityRef.current === capturedIdentity) setResult(response);
    } catch (error) {
      if (request !== serial.current || identityRef.current !== capturedIdentity) return;
      if (!(error instanceof Error && error.name === "AbortError")) setError(error instanceof Error ? error.message : "公式搜索失败");
    } finally {
      if (request === serial.current && identityRef.current === capturedIdentity) setBusy(false);
    }
  }, [busy, identity, input.pool, input.loading, input.runId, input.iteration, objective, input.modelConfig, sampled.length, groups, options, target, supplements]);

  useEffect(() => {
    if (!automatic || busy || input.loading || sampled.length < options.minSamples || groups < 8) return;
    if (lastRequested.current === 0 || sampled.length >= lastRequested.current + 10
      || !input.isRunning && sampled.length > lastRequested.current) void run();
  }, [automatic, busy, input.loading, input.isRunning, sampled.length, groups, options.minSamples, run]);

  const cancel = () => {
    serial.current++; client.current?.cancel(); setBusy(false); setAutomatic(false); setCancelled(true);
  };
  const suspend = () => {
    serial.current++; client.current?.cancel(); setBusy(false);
    if (busy) lastRequested.current = 0;
  };
  return { options, setOptions, target, setTarget, supplements, setSupplements, supplementDraft, setSupplementDraft, automatic, setAutomatic,
    result, busy, error, cancelled, run, cancel, suspend, sampleCount: sampled.length, groupCount: groups,
    materialIds, datasetIdentity: JSON.stringify([input.runId, objective]), objective: targetSpec(objective), ready: sampled.length >= options.minSamples && groups >= 8 && !input.loading };
}
export type DistillationController = ReturnType<typeof useDistillation>;
