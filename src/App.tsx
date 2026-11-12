import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { translateUI } from "./uiTranslations";
import { LanguageContext, userError } from "./i18n";
import { samplingBudgetLimit, normalizeSamplingBudget } from "./engine/RandomComparison";
import ConvergenceChart from "./components/ConvergenceChart";
import DeferredSection from "./components/DeferredSection";
import { MaterialsEngine } from "./engine/MaterialsEngine";
import { ModelWorkerClient } from "./engine/ModelWorkerClient";
import type { ModelDiagnostics } from "./engine/SurrogateModel";
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from "./engine/models/config";
import { seededRandom } from "./engine/models/math";
import { ModelControls } from "./components/ModelControls";
import type { AcquisitionStrategy } from "./engine/AcquisitionFunction";
import { getStopReason, runActiveLearningStep } from "./engine/ActiveLearningLoop";
import { Material, ALState, AL_CONFIG } from "./types";

import { type NetworkIssueCode } from "./services/NetworkStatus";
import type { AdvisorRequest } from "./components/MaterialsAdvisor";
const MaterialsAdvisor = React.lazy(() => import("./components/MaterialsAdvisor"));
import { advisorCandidates, type AdvisorAction } from "./services/AdvisorContext";

import StructurePanel from "./components/StructurePanel";
import { canViewMaterialStructure, type MaterialStructureRequest } from "./structures/materialStructure";

const UmlipPanel = React.lazy(() => import("./components/UmlipPanel"));
const CompositionDescriptorPanel = React.lazy(() => import("./components/CompositionDescriptorPanel").then(m => ({ default: m.CompositionDescriptorPanel })));
import DataHubPanel from "./components/DataHubPanel";
import { DEFAULT_HUB_QUERY, OBJECTIVES, sourceLabel, type HubMetadata, type HubQuery, type ObjectiveDirection } from "./dataHub";
import { useDistillation } from "./engine/distillation/useDistillation";
const DescriptorMap = React.lazy(() => import("./components/DistillationPanel").then(m => ({ default: m.DescriptorMap })));
const DistillationPanel = React.lazy(() => import("./components/DistillationPanel").then(m => ({ default: m.DistillationPanel })));
const ParetoExplorer = React.lazy(() => import("./components/ParetoExplorer"));
import type { CrystalStructure } from "./structures/types";
import type { LabRequest, SynthesisFeedback, ExperimentRecord, ReferenceBinding } from "./synthesis/types";
import { applySynthesisFeedback, canApplySynthesisFeedback, feedbackLabel, loadFeedbackRegistry, saveFeedbackRegistry } from "./synthesis/feedback";
import { isStrontiumTitanate, sameComposition } from "./synthesis/client";
import { materialRecordKey } from "./materialContext";
import { materialForStructure } from "./synthesis/reference";
import MethodNote from "./components/MethodNote";
import ResearchControls from "./components/ResearchControls";
import CandidateDetails from "./components/CandidateDetails";
import { DEFAULT_SCENE_QUERY, RESEARCH_SCENES, sceneForQuery } from "./research/scenes";
import { reportCandidates, sessionReport } from "./research/report";
import { downloadReport } from "./research/reportHtml";
import { sharedDecisionArchive } from "./research/decision";
import "./components/workflow.css";
import GeometryPanel from "./components/GeometryPanel";
import { emptyResearchModules, type ResearchSession, type Restore, type ResearchModules, type StructureDraft, type StructureArtifact, type GeometryResult, type FormulaArchive, type ParetoArchive, type AdvisorArchive, type UmlipArchive } from "./research/types";
import { captureSession, restoreCandidatePool, parseSession } from "./research/session";
import { researchEvidence } from "./research/evidence";
import { calibrationObservations, calibratedSurrogate } from "./research/calibration";
import { replaceGeometrySupplements } from "./research/geometry";
import { restoreValidatedFeedback, rebindValidation } from "./research/validation";
import { MaterialStructureService } from "./services/MaterialStructureService";
import { structureFingerprint } from "./structures/fingerprint";
import { structureComposition } from "./structures/geometry";
import { fromCrystalStructure, asCrystalStructure } from "./umlip/configurations";
import type { ConfigurationInput } from "./umlip/types";
import type { CalibrationResult } from "./dataHub";
import "./components/research.css";

const SynthesisLab = React.lazy(() => import("./components/SynthesisLab"));
const PresentationWorkspace = React.lazy(() => import("./components/PresentationWorkspace"));
const ResearchPresentation = React.lazy(() => import("./components/ResearchPresentation"));

const engine = new MaterialsEngine();

function initialState(budget: number, direction: ObjectiveDirection = "max"): ALState {
  return { iteration: 0, budget, sampledCount: 0, bestValue: direction === "min" ? Infinity : -Infinity, history: [] };
}

const translations = {
  en: {
    methodologyDesc: "Choose an RBF Gaussian process, tree ensembles, kNN or a linear baseline. Models train on sampled labels in a background Worker. GP posterior standard deviation and ensemble disagreement have different meanings; neither guarantees convergence or accuracy on new materials.",
    representationDesc: "A shared 22-dimensional composition representation uses offline element constants: weighted means, population variances, ranges and coverage for five properties, plus a conditional ABO3 tolerance factor and validity flag. Identical compositions have identical descriptors; crystal polymorphs require additional structural data.",
    langToggle: "中文"
  },
  zh: {
    methodologyDesc: "可选择 RBF 高斯过程、树集成、kNN 或线性基线，在后台 Worker 中使用已采样标签训练。GP 后验标准差与集成预测分歧含义不同；模型切换不保证全局收敛或对新材料的预测精度。",
    representationDesc: "所有数据源共用22维组成表示：5类元素属性的加权均值、总体方差、极差与覆盖率，加上有条件的ABO₃容忍因子和有效位。相同组成具有相同描述符；区分同质异构体仍需真实结构数据。",
    langToggle: "English"
  }
};

export default function App() {
  const [modules, setModules] = useState(emptyResearchModules);
  const modulesRef = useRef(modules); modulesRef.current = modules;
  const structureRegistry = useRef(new Map<string, StructureArtifact>());
  const hydrating = useRef(false), transferSerial = useRef(0), sessionId = useRef<string>(crypto.randomUUID());
  const [restoringSession, setRestoringSession] = useState(false), [sessionRestore, setSessionRestore] = useState<Restore<ResearchSession> | null>(null);
  const [personalPresentation, setPersonalPresentation] = useState<ResearchSession | null>(null);
  const [selectedRecordKey, setSelectedRecordKey] = useState<string | null>(null), [showCandidate, setShowCandidate] = useState(false);
  const [researchStatus, setResearchStatus] = useState("");
  const [structureRestore, setStructureRestore] = useState<Restore<CrystalStructure> | undefined>();
  const [queueRequest, setQueueRequest] = useState<Restore<ConfigurationInput[]> | undefined>();
  const [experimentRestore, setExperimentRestore] = useState<Restore<ExperimentRecord> | undefined>();
  const [geometryArtifact, setGeometryArtifact] = useState<StructureArtifact | null>(null), [showGeometry, setShowGeometry] = useState(false);
  const structureService = useRef(new MaterialStructureService());
  const onFormulaState = useCallback((formula: FormulaArchive) => { if (!hydrating.current) setModules(m => ({ ...m, formula })); }, []);
  const onParetoState = useCallback((pareto: ParetoArchive) => { if (!hydrating.current) setModules(m => ({ ...m, pareto, stability: pareto.externalStability })); }, []);
  const onAdvisorState = useCallback((advisor: AdvisorArchive) => { if (!hydrating.current) setModules(m => ({ ...m, advisor })); }, []);
  const onUmlipState = useCallback((umlip: UmlipArchive) => { if (!hydrating.current) setModules(m => ({ ...m, umlip })); }, []);
  const onExperiment = useCallback((record: ExperimentRecord) => {
    if (!hydrating.current) setModules(m => ({ ...m, experiments: [record, ...m.experiments.filter(r => r.id !== record.id)] }));
  }, []);
  const restoredFormula = useMemo(() => sessionRestore?.value.modules.formula ? { token: sessionRestore.token, value: sessionRestore.value.modules.formula } : undefined, [sessionRestore?.token]);
  const restoredPareto = useMemo(() => sessionRestore?.value.modules.pareto ? { token: sessionRestore.token, value: sessionRestore.value.modules.pareto } : undefined, [sessionRestore?.token]);
  const restoredAdvisor = useMemo(() => sessionRestore ? { token: sessionRestore.token, value: sessionRestore.value.modules.advisor ?? { turns: [], selectedId: null, draft: "", preview: false, compact: false } } : undefined, [sessionRestore?.token]);
  const restoredUmlip = useMemo(() => sessionRestore?.value.modules.umlip ? { token: sessionRestore.token, value: sessionRestore.value.modules.umlip } : undefined, [sessionRestore?.token]);
  const [presentation, setPresentation] = useState(() => new URLSearchParams(window.location.search).get("mode") === "showcase");
  const presentationNeedsReload = useRef(presentation);
  const [showUmlip, setShowUmlip] = useState(false);
  const [hasOpenedUmlip, setHasOpenedUmlip] = useState(false);
  const openUmlip = () => { setHasOpenedUmlip(true); setShowUmlip(true); };
  const [lang, setLang] = useState<"en" | "zh">(() => { try { return localStorage.getItem("ai4s-language") === "en" ? "en" : "zh"; } catch { return "zh"; } });
  const t = translations[lang];
  const tx = (zh: string, en: string) => lang === "zh" ? zh : en;
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
    document.title = lang === "zh" ? "问鼎·材料引擎 | 问鼎储能" : "Wending Materials Engine | Wending Energy";
    try { localStorage.setItem("ai4s-language", lang); } catch {}
  }, [lang]);
  const [paretoOpened, setParetoOpened] = useState(false), [paretoVisible, setParetoVisible] = useState(false);
  const [advisorOpened, setAdvisorOpened] = useState(false), [materialSearch, setMaterialSearch] = useState("");

  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [pool, setPool] = useState<Material[]>([]);
  const [synthesisFeedbacks, setSynthesisFeedbacks] = useState(loadFeedbackRegistry);
  const synthesisFeedbackRef = useRef(synthesisFeedbacks);
  const [labRequest, setLabRequest] = useState<LabRequest | null>(null);
  const [showLab, setShowLab] = useState(false);
  const labSerial = useRef(0);
  const [strategy, setStrategy] = useState<AcquisitionStrategy>("UCB");
  
  // Dynamic Configs
  const [batchSize, setBatchSize] = useState(AL_CONFIG.BATCH_SIZE);
  const [totalBudget, setTotalBudget] = useState(AL_CONFIG.TOTAL_BUDGET);
  const [hubQuery, setHubQuery] = useState<HubQuery>({ ...DEFAULT_SCENE_QUERY });
  const [hubMetadata, setHubMetadata] = useState<HubMetadata | null>(null);
  const objectiveSpec = OBJECTIVES[hubMetadata?.objective ?? hubQuery.objective];
  const [modelSettings, setModelSettings] = useState<ModelConfig>({ ...DEFAULT_MODEL_CONFIG });
  const [modelDiagnostics, setModelDiagnostics] = useState<ModelDiagnostics | undefined>();

  const [state, setState] = useState<ALState>(() => initialState(AL_CONFIG.TOTAL_BUDGET));
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isRealData, setIsRealData] = useState(false);
  const [dataIssue, setDataIssue] = useState<NetworkIssueCode | null>(null);
  const [showDocs, setShowDocs] = useState(false);
  const [expert, setExpert] = useState(false);
  const [showFormulaTools, setShowFormulaTools] = useState(false);
  const [catalogCount, setCatalogCount] = useState<number | null>(null);
  const [showAdvisor, setShowAdvisor] = useState(false);
  const [advisorRunId, setAdvisorRunId] = useState(0);
  const [advisorRequest, setAdvisorRequest] = useState<AdvisorRequest | null>(null);
  const advisorRequestId = useRef(0);
  const openAdvisor = (materialId?: string, action?: AdvisorAction) => {
    setAdvisorOpened(true);
    const chosen = pool.find(m => m.id === materialId); setSelectedRecordKey(chosen ? materialRecordKey(chosen) : null);
    setAdvisorRequest({ requestId: ++advisorRequestId.current, materialId, action });
    setShowAdvisor(true);
  };
  const [showStructure, setShowStructure] = useState(false);
  const [hasOpenedStructure, setHasOpenedStructure] = useState(false);
  const [structureMaterial, setStructureMaterial] = useState<MaterialStructureRequest | null>(null);
  const structureRequestId = useRef(0);
  const openStructure = () => { setStructureMaterial(null); setHasOpenedStructure(true); setShowStructure(true); };
  const openMaterialStructure = (material: Material) => {
    setStructureMaterial({ id: material.id, formula: material.formula, source: material.source, structureRef: material.structureRef, requestId: ++structureRequestId.current });
    setHasOpenedStructure(true); setShowStructure(true);
  };
  const openSynthesisLab = (material?: Material, structure?: CrystalStructure, referenceBinding?: ReferenceBinding) => {
    const chosen = material || (structure ? materialForStructure(pool, structure)
      : pool.find(m => isStrontiumTitanate(m.composition)) || advisorCandidates(pool)[0] || pool[0]);
    setLabRequest({ requestId: ++labSerial.current, materialId: chosen?.id, formula: chosen?.formula,
      composition: chosen?.composition, source: chosen?.source, recordKey: chosen ? materialRecordKey(chosen) : undefined,
      structureRef: chosen?.structureRef, structure, referenceBinding });
    setShowStructure(false); setShowLab(true);
  };
  const [isIterating, setIsIterating] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const loadRequest = useRef(0);
  const restoreRequest = useRef<AbortController | null>(null);
  const runVersion = useRef(0);
  const iterationInFlight = useRef(false);
  const modelClient = useRef<ModelWorkerClient | null>(null);
  const activeRun = useRef<AbortController | null>(null);
  const stopReason = getStopReason(pool, totalBudget);
  const budgetLimit = samplingBudgetLimit(pool.length);
  const sourceRecord = pool.find(m => m.provenance);
  const bestMaterial = useMemo(() => pool.filter(m => m.isSampled).sort((a,b) => (objectiveSpec.direction === "min" ? a.trueProperty - b.trueProperty : b.trueProperty - a.trueProperty) || a.id.localeCompare(b.id))[0], [pool, objectiveSpec.direction]);
  const [formulaMap, setFormulaMap] = useState(false);
  const distillation = useDistillation({ pool, runId: advisorRunId, iteration: state.iteration,
    isRealData, objective: hubMetadata?.objective ?? hubQuery.objective, modelConfig: modelSettings, isRunning: isAutoRunning,
    loading: isLoadingData || presentation || restoringSession, restored: restoredFormula, onState: onFormulaState,
    calibration: modules.calibrationEnabled ? modules.calibration : null });

  const cancelComputation = () => {
    runVersion.current++;
    activeRun.current?.abort();
    modelClient.current?.cancel();
    iterationInFlight.current = false;
    setIsIterating(false);
  };
  const acceptSynthesisFeedback = (feedback: SynthesisFeedback) => {
    if (!feedback.recordKey || !pool.some(material => canApplySynthesisFeedback(material, feedback))) return false;
    cancelComputation(); setIsAutoRunning(false);
    const registry = { ...synthesisFeedbackRef.current, [feedback.recordKey]: feedback };
    synthesisFeedbackRef.current = registry;
    setSynthesisFeedbacks(registry); saveFeedbackRegistry(registry);
    setPool(current => applySynthesisFeedback(current, feedback));
    return true;
  };
  const labPanel = labRequest && <React.Suspense fallback={showLab ? <p role="status" className="fixed bottom-4 left-4 z-50 bg-white p-3 rounded shadow">{tx("正在打开合成与 XRD 实验室…", "Opening synthesis and XRD workspace…")}</p> : null}>
    <SynthesisLab open={showLab} onClose={() => setShowLab(false)} request={labRequest} materials={pool} onFeedback={acceptSynthesisFeedback}
      restored={experimentRestore} onRecord={onExperiment} stability={modules.stability} />
  </React.Suspense>;

  const loadData = async (query: HubQuery, requestedBudget = totalBudget) => {
    setAdvisorRequest(null); setShowAdvisor(false);
    restoreRequest.current?.abort(); hydrating.current = false; setRestoringSession(false);
    setModules(m => ({ ...m, formula: null, pareto: null, advisor: null, calibration: null, calibrationEnabled: false })); setSessionRestore(null); setSelectedRecordKey(null); setShowCandidate(false); setShowGeometry(false);
    setQueueRequest(undefined); setExperimentRestore(undefined);
    setShowLab(false); setLabRequest(null);
    setHubQuery(query);
    setAdvisorRunId(value => value + 1);
    const request = ++loadRequest.current;
    cancelComputation();
    setModelDiagnostics(undefined);
    setIsAutoRunning(false);
    setRunError(null);
    setDataIssue(null);
    setIsLoadingData(true);
    try {
      const metadata = await engine.loadHubData(query);
      if (request !== loadRequest.current) return;
      if (!metadata) return;
      const connected = await restoreValidatedFeedback(engine.getPool(), synthesisFeedbackRef.current);
      if (request !== loadRequest.current) return;
      setPool(connected.pool);
      const boundedBudget = normalizeSamplingBudget(requestedBudget, connected.pool.length);
      setTotalBudget(boundedBudget);
      if (connected.unavailable) setResearchStatus(`${connected.unavailable}份构型验证记录需重新关联本机运行历史，其余数据已载入。`);
      setHubMetadata(metadata);
      setIsRealData(true);
      setDataIssue(engine.getLoadIssue());
      setState(initialState(boundedBudget, OBJECTIVES[metadata.objective].direction));
      setIsLoaded(true);
    } catch (error) {
      if (request !== loadRequest.current) return;
      setPool([]);
      setHubMetadata(null);
      setState(initialState(totalBudget, OBJECTIVES[query.objective].direction));
      setIsRealData(false);
      setDataIssue("NETWORK_ERROR");
      setRunError(userError(error, lang));
      setIsLoaded(true);
    } finally {
      if (request === loadRequest.current) setIsLoadingData(false);
    }
  };

  useEffect(() => {
    if (!presentation) void loadData(hubQuery);
    return () => {
      loadRequest.current++;
      runVersion.current++;
      activeRun.current?.abort();
      modelClient.current?.dispose();
      iterationInFlight.current = false;
      engine.cancelLoad();
    };
  }, []);

  const runIteration = async () => {
    if (iterationInFlight.current || isLoadingData) return;
    const version = runVersion.current;
    iterationInFlight.current = true;
    setIsIterating(true);
    const controller = new AbortController();
    activeRun.current = controller;
    try {
      if (!modelClient.current) modelClient.current = new ModelWorkerClient(modelSettings);
      const result = await runActiveLearningStep(pool, state, {
        totalBudget, batchSize, strategy, comparisonSeed: modelSettings.seed, direction: objectiveSpec.direction, signal: controller.signal, random: seededRandom(modelSettings.seed),
      }, modules.calibrationEnabled && modules.calibration ? calibratedSurrogate(modelClient.current, modules.calibration) : modelClient.current);
      if (version !== runVersion.current) return;
      setPool(result.pool);
      setState(result.state);
      setModelDiagnostics(modelClient.current.diagnostics);
      if (result.stopReason) setIsAutoRunning(false);
    } catch (error) {
      if (version !== runVersion.current) return;
      setRunError((lang === "zh" ? "模型迭代失败，请重置后重试：" : "Model iteration failed. Reset and retry: ")
        + userError(error, lang));
      setIsAutoRunning(false);
    } finally {
      if (version === runVersion.current) {
        iterationInFlight.current = false;
        setIsIterating(false);
        activeRun.current = null;
      }
    }
  };

  const reset = () => {
    setAdvisorRequest(null); setShowAdvisor(false);
    setAdvisorRunId(value => value + 1);
    cancelComputation();
    setModelDiagnostics(undefined);
    setRunError(null);
    // In-place reset of the current pool to avoid re-loading from API
    const resetPool = pool.map(m => ({
      ...m,
      isSampled: false,
      iteration: undefined,
      predictedMean: undefined,
      predictedStd: undefined,
      acquisitionValue: undefined
    }));
    
    setPool(resetPool);
    setModules(m => ({ ...m, pareto: sharedDecisionArchive(resetPool, hubMetadata?.objective ?? hubQuery.objective, modelSettings.seed, m.pareto) }));
    const boundedBudget = normalizeSamplingBudget(totalBudget, resetPool.length);
    setTotalBudget(boundedBudget);
    setState(initialState(boundedBudget, objectiveSpec.direction));
    setIsAutoRunning(false);
  };

  useEffect(() => {
    if (!isAutoRunning || isLoadingData || isIterating) return;
    if (stopReason || runError) {
      setIsAutoRunning(false);
      return;
    }
    const timer = setTimeout(() => { void runIteration(); }, 800);
    return () => clearTimeout(timer);
  }, [isAutoRunning, isLoadingData, isIterating, pool, state, strategy, batchSize, totalBudget, stopReason, runError]);

  const topAdvisorCandidates = useMemo(() => advisorCandidates(pool), [pool]);
  const selectedMaterial = useMemo(() => pool.find(m => materialRecordKey(m) === selectedRecordKey) ?? null, [pool, selectedRecordKey]);
  const moduleEvidence = useMemo(() => researchEvidence(modules, selectedRecordKey), [modules, selectedRecordKey]);
  const chooseCandidate = (recordKey: string) => { setSelectedRecordKey(recordKey); setShowCandidate(true); };
  async function registerStructure(draft: StructureDraft): Promise<StructureArtifact> {
    const structureHash = await structureFingerprint(draft.structure);
    const linked = materialForStructure(pool, draft.structure);
    const recordKey = draft.recordKey ?? (linked ? materialRecordKey(linked) : undefined);
    const registryKey = JSON.stringify([structureHash, recordKey, draft.stage, draft.runId, draft.candidateId]);
    const old = structureRegistry.current.get(registryKey);
    if (old) return old;
    const artifact: StructureArtifact = { ...draft, recordKey, structureHash, id: crypto.randomUUID(), createdAt: new Date().toISOString() };
    structureRegistry.current.set(registryKey, artifact);
    setModules(m => ({ ...m, structures: [...m.structures, artifact].slice(-128) })); return artifact;
  }
  async function rememberStructure(structure: CrystalStructure) {
    try { await registerStructure({ structure, stage: structure.source.recordRef ? "database" : "imported" }); } catch (e) { setResearchStatus((e as Error).message); }
  }
  useEffect(() => {
    const run = modules.umlip?.run; if (!run) return;
    for (const c of run.candidates.filter(c => c.status === "converged" && c.result)) {
      void registerStructure({ structure: asCrystalStructure(c.result!.structure, c.name, `${run.id}/${c.id}/POSCAR.relaxed`),
        stage: "relaxed", runId: run.id, candidateId: c.id, modelSha256: run.model?.sha256,
        recordKey: c.origin?.recordKey, parentStructureHash: c.origin?.structureHash }).catch(e => setResearchStatus((e as Error).message));
    }
  }, [modules.umlip?.run]);
  async function getStructure(material: Material) {
    const result = await structureService.current.get(material);
    if (result.kind !== "ready") throw new Error("当前记录尚无可用晶胞，请在结构工作台导入并关联结构。");
    return registerStructure({ structure: result.structure, recordKey: materialRecordKey(material), stage: "database" });
  }
  async function useStructure(draft: StructureDraft, action: "queue" | "geometry" | "xrd") {
    try {
      const artifact = await registerStructure(draft);
      setShowCandidate(false); setShowStructure(false); setShowUmlip(false);
      if (action === "geometry") { setGeometryArtifact(artifact); setShowGeometry(true); return; }
      const material = pool.find(m => materialRecordKey(m) === artifact.recordKey);
      if (action === "xrd") {
        if (material && artifact.stage === "relaxed" && artifact.runId && artifact.candidateId) {
          const response = await fetch(`/api/umlip/runs/${encodeURIComponent(artifact.runId)}/candidates/${encodeURIComponent(artifact.candidateId)}/reference`);
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "构型验证来源不可用。");
          if (data.binding.recordKey !== materialRecordKey(material) || data.binding.structureHash !== artifact.structureHash) throw new Error("构型验证身份不匹配。");
          const linkedMaterial = rebindValidation(material, data.binding as ReferenceBinding, synthesisFeedbackRef.current[artifact.recordKey!]);
          setPool(current => current.map(m => materialRecordKey(m) === artifact.recordKey ? rebindValidation(m, data.binding, synthesisFeedbackRef.current[artifact.recordKey!]) : m));
          openSynthesisLab(linkedMaterial, data.structure, data.binding);
        } else openSynthesisLab(material, artifact.structure);
        return;
      }
      const input: ConfigurationInput = { id: `cfg-${(++transferSerial.current).toString(36)}-${Date.now().toString(36)}`,
        name: artifact.structure.name, source: artifact.structure.source.filename, structure: fromCrystalStructure(artifact.structure),
        ...(artifact.recordKey ? { origin: { recordKey: artifact.recordKey, structureHash: artifact.structureHash, materialId: material?.id } } : {}) };
      setQueueRequest({ token: ++transferSerial.current, value: [input] }); setHasOpenedUmlip(true); setShowUmlip(true);
      setResearchStatus("已加入构型队列；可继续加入同成分结构，或生成位移候选。");
    } catch (e) { setResearchStatus((e as Error).message); }
  }
  function applyGeometry(material: Material, result: GeometryResult) {
    if (!sameComposition(material.composition, structureComposition(geometryArtifact!.structure))) { setResearchStatus("几何结构与材料组成不一致。"); return; }
    distillation.setSupplements(replaceGeometrySupplements(distillation.supplements, material.id, result));
    setModules(m => ({ ...m, geometry: [...m.geometry.filter(g => !(g.recordKey === result.recordKey && g.structureHash === result.structureHash && g.centerSiteIndex === result.centerSiteIndex)), result] }));
    setSelectedRecordKey(materialRecordKey(material)); setShowGeometry(false); setFormulaMap(false);
    setResearchStatus("几何补充量已发送到白盒公式，来源与结构版本已一并保存。");
    document.getElementById("distillation-heading")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  async function candidateAction(action: "structure" | "queue" | "xrd" | "advisor" | "formula" | "decision", material: Material) {
    setShowCandidate(false);
    if (action === "structure") { openMaterialStructure(material); return; }
    if (action === "advisor") { openAdvisor(material.id, "integrated"); return; }
    if (action === "formula") { setShowFormulaTools(true); setFormulaMap(!!distillation.result); requestAnimationFrame(() => document.getElementById("distillation-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" })); return; }
    if (action === "decision") { setParetoOpened(true); setParetoVisible(true); requestAnimationFrame(() => document.getElementById("decision-workspace")?.scrollIntoView({ behavior: "smooth" })); return; }
    if (action === "xrd") { openSynthesisLab(material); return; }
    try { const artifact = await getStructure(material); await useStructure(artifact, "queue"); } catch (e) { setResearchStatus((e as Error).message); }
  }
  function syncObservations(keys: string[]) {
    cancelComputation(); setIsAutoRunning(false);
    const known = new Set(keys); const next = pool.map(m => known.has(materialRecordKey(m)) ? { ...m, isSampled: true, iteration: m.iteration ?? state.iteration } : m);
    const sampled = next.filter(m => m.isSampled); setPool(next); setState(s => ({ ...s, comparison: undefined, history: [], sampledCount: sampled.length,
      bestValue: sampled.length ? (objectiveSpec.direction === "min" ? Math.min : Math.max)(...sampled.map(m => m.trueProperty)) : s.bestValue }));
    setResearchStatus(`多目标观测已接入单目标学习，共${sampled.length}条已观测记录。`);
  }
  function useCalibration(result: CalibrationResult, enabled: boolean) {
    try {
      const calibrated = calibrationObservations(result, pool);
      const next = enabled ? calibrated : pool.map(m => ({ ...m, predictedMean: undefined, predictedStd: undefined, acquisitionValue: undefined }));
      cancelComputation(); setIsAutoRunning(false); modelClient.current?.dispose(); modelClient.current = null;
      setPool(next); setModelDiagnostics(undefined);
      if (enabled) {
        const sampled = next.filter(m => m.isSampled);
        setState({ ...initialState(totalBudget, objectiveSpec.direction), sampledCount: sampled.length,
          bestValue: (objectiveSpec.direction === "min" ? Math.min : Math.max)(...sampled.map(m => m.trueProperty)) });
        setAdvisorRunId(v => v + 1);
      }
      setModules(m => ({ ...m, calibration: result, calibrationEnabled: enabled }));
      setResearchStatus(enabled ? "校准预测已接入：代理拟合DFT配对值，预测转换到实验尺度。" : "校准结果已保存，当前使用原始目标预测。");
    } catch (e) { setResearchStatus((e as Error).message); }
  }
  async function captureResearch(name: string) {
    cancelComputation(); setIsAutoRunning(false); distillation.suspend();
    const collected = structuredClone(modulesRef.current);
    const u = collected.umlip;
    if (u?.run) {
      u.files = { ...u.files };
      for (const candidate of u.run.candidates.filter(c => c.result)) {
        const id = candidate.id;
        if (u.files[id]?.poscar && u.files[id]?.trajectory) continue;
        try {
          const base = `/api/umlip/runs/${u.run.id}/candidates/${id}`;
          const [poscar, trajectory] = await Promise.all([fetch(base + "/poscar"), fetch(base + "/trajectory")]);
          if (!poscar.ok || !trajectory.ok) throw new Error("原始输出文件暂不可用；结构及数值结果已保留。");
          u.files[id] = { poscar: await poscar.text(), trajectory: await trajectory.text() };
        } catch (e) { u.files[id] = { ...u.files[id], error: (e as Error).message }; }
      }
    }
    return captureSession({ id: sessionId.current, name, query: hubQuery, metadata: hubMetadata, pool, state,
      config: { strategy, batchSize, totalBudget, model: modelSettings }, modules: collected, selectedRecordKey });
  }
  async function restoreResearch(input: ResearchSession) {
    const saved = parseSession(input); setRestoringSession(true); hydrating.current = true;
    const version = ++loadRequest.current, controller = new AbortController(); restoreRequest.current?.abort(); restoreRequest.current = controller;
    engine.cancelLoad(); cancelComputation(); distillation.suspend(); setIsAutoRunning(false); setIsLoadingData(false);
    try {
      const records = await restoreCandidatePool(saved, controller.signal);
      const connected = await restoreValidatedFeedback(records, {}, controller.signal), restoredPool = connected.pool;
      if (version !== loadRequest.current) throw new Error("研究恢复已取消。");
      controller.signal.throwIfAborted();
      if (saved.modules.calibrationEnabled && saved.modules.calibration) calibrationObservations(saved.modules.calibration, restoredPool);
      setShowAdvisor(false); setShowLab(false); setShowStructure(false); setShowUmlip(false); setShowCandidate(false); setShowGeometry(false);
      setPool(restoredPool); setHubQuery(saved.query); setHubMetadata(saved.metadata); setIsRealData(saved.query.source !== undefined); setIsLoaded(true); setRunError(null);
      const restoredBudget = normalizeSamplingBudget(saved.config.totalBudget, restoredPool.length, saved.state.sampledCount);
      setStrategy(saved.config.strategy); setBatchSize(saved.config.batchSize); setTotalBudget(restoredBudget); setModelSettings(saved.config.model);
      const value = saved.state.bestValue ?? (OBJECTIVES[saved.query.objective].direction === "min" ? Infinity : -Infinity);
      const direction = OBJECTIVES[saved.query.objective].direction;
      const globalBest = restoredPool.length ? (direction === "min" ? Math.min : Math.max)(...restoredPool.map(m => m.trueProperty)) : value;
      structureRegistry.current.clear();
      for (const a of saved.modules.structures) structureRegistry.current.set(JSON.stringify([a.structureHash, a.recordKey, a.stage, a.runId, a.candidateId]), a);
      const restoredModules = { ...saved.modules, structures: [...structureRegistry.current.values()] };
      setState({ ...saved.state, budget: restoredBudget, bestValue: value, history: saved.state.history.map(h => ({ ...h, avgError: 0,
        regret: direction === "min" ? h.bestValue - globalBest : globalBest - h.bestValue })) }); setModules(restoredModules); sessionId.current = saved.id;
      const registry = { ...synthesisFeedbackRef.current };
      for (const m of restoredPool) if (m.synthesisFeedback && canApplySynthesisFeedback(m, m.synthesisFeedback)) registry[materialRecordKey(m)] = m.synthesisFeedback;
      synthesisFeedbackRef.current = registry; setSynthesisFeedbacks(registry); saveFeedbackRegistry(registry);
      modelClient.current?.dispose(); modelClient.current = null; setModelDiagnostics(undefined); setSelectedRecordKey(saved.selectedRecordKey);
      const token = ++transferSerial.current; setSessionRestore({ token, value: saved }); setAdvisorRunId(v => v + 1);
      const structure = saved.modules.structures.at(-1); setHasOpenedStructure(!!structure); setStructureMaterial(null);
      setStructureRestore(structure ? { token, value: structure.structure } : undefined);
      setHasOpenedUmlip(!!saved.modules.umlip); setQueueRequest(undefined);
      const experiment = saved.modules.experiments[0];
      setLabRequest(experiment ? { requestId: ++labSerial.current, materialId: experiment.materialId, recordKey: experiment.reference.binding?.recordKey, structure: experiment.reference.structure } : null);
      setExperimentRestore(experiment ? { token, value: experiment } : undefined);
      presentationNeedsReload.current = false; setPersonalPresentation(null); setPresentation(false);
      const url = new URL(window.location.href); url.searchParams.set("mode", "research"); window.history.replaceState(null, "", url);
      requestAnimationFrame(() => { if (version === loadRequest.current) { hydrating.current = false; setRestoringSession(false); } });
      setResearchStatus(connected.unavailable ? `研究已恢复；${connected.unavailable}份构型验证记录需重新关联本机运行历史。` : "研究存档已按精确数据版本恢复。");
    } catch (e) { if (version === loadRequest.current) { hydrating.current = false; setRestoringSession(false); } throw e; }
  }
  function presentResearch(session: ResearchSession) {
    restoreRequest.current?.abort(); hydrating.current = false; setRestoringSession(false);
    loadRequest.current++; engine.cancelLoad(); cancelComputation(); distillation.suspend(); setIsAutoRunning(false); setIsLoadingData(false);
    setShowAdvisor(false); setShowLab(false); setShowStructure(false); setShowUmlip(false); setShowCandidate(false); setShowGeometry(false);
    presentationNeedsReload.current = !isLoaded; setPersonalPresentation(session); setPresentation(true);
  }

  const openPresentation = () => {
    restoreRequest.current?.abort(); hydrating.current = false; setRestoringSession(false);
    setPersonalPresentation(null);
    presentationNeedsReload.current = isLoadingData || !isLoaded;
    loadRequest.current++; engine.cancelLoad(); cancelComputation(); distillation.suspend();
    setIsAutoRunning(false); setIsLoadingData(false);
    setShowLab(false); setShowStructure(false); setShowUmlip(false); setShowAdvisor(false); setShowCandidate(false); setShowGeometry(false);
    const url = new URL(window.location.href); url.searchParams.set("mode", "showcase");
    window.history.replaceState(null, "", url); setPresentation(true);
  };
  const closePresentation = () => {
    const url = new URL(window.location.href); url.searchParams.set("mode", "research");
    window.history.replaceState(null, "", url); setPresentation(false);
    if (presentationNeedsReload.current) { presentationNeedsReload.current = false; void loadData(hubQuery); }
  };
  const presentationView = presentation && <React.Suspense fallback={<div className="presentation-loading"><p>{tx("正在打开完整路演快照…", "Opening the demonstration snapshot…")}</p></div>}>
    {personalPresentation ? <ResearchPresentation session={personalPresentation} onExit={closePresentation} /> : <PresentationWorkspace onExit={closePresentation} />}
  </React.Suspense>;


  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/hub/catalog", { signal: controller.signal }).then(r => r.json()).then(c => {
      const entry = c.sources?.find((x: { id: string }) => x.id === "mp-snapshot"); setCatalogCount(entry?.count ?? null);
    }).catch(() => {});
    return () => controller.abort();
  }, [hubMetadata?.datasetVersion]);
  useEffect(() => {
    if (!pool.length || isLoadingData || restoringSession) return;
    setModules(m => m.pareto && !m.pareto.workflowShared ? m : { ...m, pareto: sharedDecisionArchive(pool, hubMetadata?.objective ?? hubQuery.objective, modelSettings.seed, m.pareto) });
  }, [pool, isLoadingData, restoringSession, hubMetadata?.objective, modelSettings.seed]);
  const liveSession = useMemo(() => captureSession({ id: sessionId.current, name: tx("材料筛选研究报告", "Materials screening report"),
    query: hubMetadata?.query ?? hubQuery, metadata: hubMetadata, pool, state,
    config: { strategy, batchSize, totalBudget, model: modelSettings }, modules, selectedRecordKey }),
    [pool, state, modules, hubMetadata, hubQuery, strategy, batchSize, totalBudget, modelSettings, selectedRecordKey, lang]);
  const liveReport = useMemo(() => sessionReport(liveSession), [liveSession]);
  const shortlist = useMemo(() => reportCandidates(liveReport.candidates, hubMetadata?.objective ?? hubQuery.objective), [liveReport]);
  const sceneId = sceneForQuery(hubMetadata?.query ?? hubQuery);
  const openCurrentReport = () => { void captureResearch(tx("材料筛选研究报告", "Materials screening report")).then(presentResearch).catch(e => setResearchStatus(userError(e, lang))); };
  const disabled = isLoadingData || isIterating || restoringSession;
  return <LanguageContext.Provider value={lang}>{presentationView}
    <div hidden={presentation} style={presentation ? { display: "none" } : undefined} className={"workflow-shell ai4s-app-shell" + (expert ? " expert-active" : "")}>
      <header className="workflow-header">
        <div><span className="workflow-eyebrow">{tx("问鼎储能", "Wending Energy")}</span><h1>{tx("问鼎·材料引擎", "Wending · Materials Engine")}</h1></div>
        <div className="workflow-actions">
          <button aria-pressed={expert} onClick={() => setExpert(!expert)}>{tx("专家模式", "Expert mode")}</button>
          <button onClick={openPresentation}>{tx("示例报告", "Example report")}</button>
          <button onClick={() => setLang(lang === "zh" ? "en" : "zh")}>{t.langToggle}</button>
        </div>
      </header>
      <section className="workflow-intro"><h2>{tx("从海量材料，到值得验证的三个候选", "From a materials collection to three candidates worth testing")}</h2><p>{tx("为每个候选回答：表现如何、为什么值得关注、成本怎样、结构如何、怎么验证。", "A research answer for each candidate: performance, interpretable trends, cost, structure and verification.")}</p></section>
      <nav className="workflow-steps" aria-label={tx("研究流程", "Research workflow")}>
        <a href="#scene-selection"><b>1</b>{tx("选场景", "Choose a scenario")}</a>
        <a href="#screening-workspace"><b>2</b>{tx("AI 筛选", "AI screening")}</a>
        <a href="#candidate-reports"><b>3</b>{tx("候选报告", "Candidate reports")}</a>
      </nav>
      <section id="scene-selection" className="workflow-card workflow-scenes"><div><span className="workflow-eyebrow">01 · {tx("选场景", "SCENARIO")}</span><h2>{tx("这次要解决什么材料问题？", "Which materials problem are you solving?")}</h2></div>
        <div className="workflow-scene-grid">{RESEARCH_SCENES.map(scene => <button key={scene.id} disabled={!scene.available || disabled || isAutoRunning} aria-pressed={sceneId === scene.id} onClick={() => { if (scene.query) { setStrategy("UCB"); setModelSettings({ ...DEFAULT_MODEL_CONFIG }); modelClient.current?.dispose(); modelClient.current = null; void loadData({ ...scene.query }, 50); } }}><b>{scene[lang]}</b><span>{lang === "zh" ? scene.descriptionZh : scene.descriptionEn}</span></button>)}</div>
        <div className="workflow-source-line"><span className="workflow-badge">{tx("数据可追溯", "Traceable data")}</span><span>{sourceLabel(hubMetadata?.effectiveSource ?? hubQuery.source, lang)} · {hubMetadata?.sourceVersion ?? hubMetadata?.datasetVersion ?? tx("正在读取目录", "Reading catalog")}</span><details><summary>{tx("来源与快照", "Source & snapshot")}</summary><p>{sourceRecord?.provenance?.reference} · {sourceRecord?.provenance?.license}</p><p className="report-identity">SHA256 {hubMetadata?.snapshotSha256 ?? "—"}</p>{sourceRecord?.provenance?.url && <a href={sourceRecord.provenance.url} target="_blank" rel="noreferrer">{tx("原始来源 / DOI", "Original source / DOI")} ↗</a>}</details></div>
      </section>
      {expert && <section className="workflow-card workflow-expert" aria-label={tx("专家设置", "Expert settings")}><h2>{tx("专家模式 · 自定义研究", "Expert mode · custom research")}</h2><p>{tx("自定义数据、目标、模型与采样参数；切换数据会开始新的研究。", "Customize sources, objectives, models and sampling settings. Changing datasets starts a new study.")}</p>
        <div className="workflow-expert-grid"><DataHubPanel query={hubQuery} metadata={hubMetadata} count={pool.length} loading={isLoadingData || restoringSession} lang={lang} onChange={setHubQuery} onLoad={q => void loadData(q)} recordIds={pool.map(m => m.id)} onCalibration={useCalibration} providedCalibration={modules.calibration} calibrationEnabled={modules.calibrationEnabled} />
          <div><section className="workflow-settings"><h3>{tx("采样设置", "Sampling settings")}</h3><label>{tx("下一候选选择策略", "Next-candidate strategy")}<select value={strategy} disabled={disabled || isAutoRunning || state.iteration > 0} onChange={e => setStrategy(e.target.value as AcquisitionStrategy)}><option value="UCB">UCB</option><option value="EI">EI</option><option value="Uncertainty">{tx("不确定性采样", "Uncertainty")}</option><option value="Random">{tx("成本加权随机", "Cost-aware random")}</option></select></label><label>{tx("每批评价数", "Batch size")}<input type="number" min="1" max="20" value={batchSize} disabled={disabled || state.iteration > 0} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20) setBatchSize(n); }} /></label><label>{tx("本轮评价预算", "Evaluation budget")}<input type="number" min="1" max={Math.max(1, budgetLimit)} value={totalBudget} disabled={disabled || state.iteration > 0} onChange={e => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= budgetLimit) setTotalBudget(n); }} /></label></section>
          <ModelControls config={modelSettings} lang={lang} busy={isIterating} diagnostics={modelDiagnostics} locked={disabled || isAutoRunning || state.iteration > 0} onChange={config => { cancelComputation(); modelClient.current?.dispose(); modelClient.current = null; setModelSettings(config); setModelDiagnostics(undefined); }} />
          <div className="workflow-actions"><button onClick={openStructure}>{tx("导入结构 / 3D", "Import structure / 3D")}</button><button onClick={openUmlip}>{tx("构型计算", "Configuration calculations")}</button><button onClick={() => openSynthesisLab()}>{tx("合成 / XRD", "Synthesis / XRD")}</button><button onClick={() => setShowDocs(true)}>{tx("方法说明", "Methods")}</button></div></div></div>
      </section>}
      <section id="screening-workspace" className="workflow-card">
        <div className="workflow-section-header"><div><span className="workflow-eyebrow">02 · {tx("AI 筛选", "AI SCREENING")}</span><h2>{tx("用有限评价，找到值得继续研究的材料", "Find promising materials within an evaluation budget")}</h2></div><div className="workflow-actions"><button disabled={disabled || isAutoRunning || !pool.length} onClick={reset}>{tx("重新筛选", "Reset screening")}</button><button id="run-learning" className="workflow-primary" disabled={!isAutoRunning && (disabled || !isLoaded || !!stopReason || !!runError || budgetLimit < 1)} onClick={() => { if (isAutoRunning) cancelComputation(); setIsAutoRunning(!isAutoRunning); }}>{isAutoRunning ? tx("暂停筛选", "Pause screening") : (stopReason === "budget-exhausted" ? tx("筛选完成", "Screening complete") : tx("开始 AI 筛选", "Start AI screening"))}</button></div></div>
        <div className="workflow-funnel" aria-label={tx("材料筛选漏斗", "Materials screening funnel")}>{[
          [catalogCount?.toLocaleString() ?? "—", tx("材料数据底座", "Materials collection")],
          [(hubMetadata?.matchedTotal ?? pool.length).toLocaleString(), tx("匹配场景条件", "Matching scenario")],
          [pool.length.toLocaleString(), tx("本轮候选池", "Study candidate pool")],
          [String(state.sampledCount) + " / " + totalBudget, tx("已评价 / 预算", "Evaluated / budget")],
          [shortlist.length ? "Top " + shortlist.length : "Top 3", tx("候选研究报告", "Candidate reports")]
        ].map(([value, label], i) => <div key={label}><span>{label}</span><strong>{value}</strong><i style={{ width: (100 - i * 12) + "%" }} /></div>)}</div>
        <div className="workflow-evaluation-line"><span className="workflow-badge">{tx("已有计算数据 · 回溯验证", "Computed-data retrospective validation")}</span><span>{objectiveSpec[lang]} {objectiveSpec.direction === "min" ? "↓" : "↑"} · {sceneId === "solid-electrolyte" ? tx("联合查看热力学稳定性", "With thermodynamic stability") : tx("自定义研究", "Custom research")}</span><MethodNote lang={lang}>{tx("每次评价揭示本轮候选池已有的数据库标签，以相同预算和初始样本对照随机选材。漏斗区分数据底座、条件匹配和实际载入的候选。", "Each evaluation reveals an existing label in this pool. Random sampling uses the same budget and initial observations. The funnel separates collection size, matched records and the loaded study pool.")}</MethodNote></div>
        {isLoadingData && <p role="status">{tx("正在加载场景数据…", "Loading scenario data…")}</p>}
        {(runError || stopReason || researchStatus) && <p className="workflow-status" role={runError ? "alert" : "status"}>{runError || (stopReason === "budget-exhausted" ? tx("本轮筛选完成，请查看候选报告。", "Screening complete. Review candidate reports.") : stopReason === "empty-pool" ? tx("当前条件没有可用材料，可在专家模式调整数据，或先查看示例报告。", "No materials match. Adjust the dataset in expert mode or open an example report.") : stopReason === "candidates-exhausted" ? tx("本轮候选已全部评价。", "All study candidates have been evaluated.") : userError(translateUI(researchStatus, lang), lang))}</p>}
        {!presentation && <ConvergenceChart compact state={state} strategy={strategy} direction={objectiveSpec.direction} unit={objectiveSpec.unit} lang={lang} />}
      </section>
      <section id="candidate-reports" className="workflow-card"><div className="workflow-section-header"><div><span className="workflow-eyebrow">03 · {tx("候选报告", "CANDIDATE REPORTS")}</span><h2>{tx("每一次选材，都有完整的研究答案", "A complete research answer for every material choice")}</h2><p>{tx("已评价优选 · 表现、规律、取舍、结构与验证", "Evaluated shortlist · performance, trends, trade-offs, structure and verification")}</p></div><div className="workflow-actions"><button disabled={disabled || !state.sampledCount} onClick={openCurrentReport}>{tx("打开完整研究报告", "Open complete report")}</button><button disabled={disabled || !state.sampledCount} onClick={() => downloadReport(liveReport, lang)}>{tx("导出网页 / PDF", "Export HTML / PDF")}</button></div></div>
        {shortlist.length ? <div className="workflow-shortlist">{shortlist.map((m, i) => <article key={m.recordKey}><span className="workflow-eyebrow">TOP 0{i + 1}</span><h3>{m.formula}</h3><strong>{m.observedValue?.toPrecision(6)} <small>{objectiveSpec.unit}</small></strong><p>{m.id}</p><button onClick={() => chooseCandidate(m.recordKey)}>{tx("查看五项研究答案", "View five research answers")} ↗</button></article>)}</div> : <div className="workflow-empty"><p>{tx("选择场景并开始 AI 筛选，优选候选将在这里生成报告。", "Choose a scenario and start screening to create candidate reports.")}</p><button onClick={openPresentation}>{tx("先看一份完整示例报告", "Explore an example report")}</button></div>}
        {expert && !!topAdvisorCandidates.length && <details className="workflow-next"><summary>{tx("下一步值得验证的候选", "Candidates for the next evaluation")}</summary><div className="workflow-actions">{topAdvisorCandidates.map(m => <button key={m.id} onClick={() => chooseCandidate(materialRecordKey(m))}>{m.formula} · μ {m.predictedMean?.toFixed(3)}</button>)}</div></details>}
      </section>
      <details id="distillation-workspace" className="workflow-card" open={showFormulaTools} onToggle={e => setShowFormulaTools(e.currentTarget.open)}><summary>{tx("候选报告 · 可解释规律与组成分析", "Report tools · interpretable relations & composition")}</summary>{showFormulaTools && <React.Suspense fallback={<p>{tx("正在打开规律分析…", "Loading relation analysis…")}</p>}><DistillationPanel controller={distillation} lang={lang} /><DescriptorMap pool={pool} result={distillation.result} lang={lang} enabled={formulaMap} highlightedId={selectedMaterial?.id} onToggle={() => setFormulaMap(v => !v)} objective={hubMetadata?.objective ?? hubQuery.objective} /></React.Suspense>}</details>
      <details id="decision-workspace" className="workflow-card" open={paretoVisible} onToggle={e => { setParetoVisible(e.currentTarget.open); if (e.currentTarget.open) setParetoOpened(true); }}><summary>{tx("候选报告 · 性能、稳定性与成本取舍", "Report tools · performance, stability & cost")}</summary>{(paretoOpened || restoredPareto) && <React.Suspense fallback={<p>{tx("正在打开决策工具…", "Loading decision tools…")}</p>}><ParetoExplorer key={"pareto-" + (sessionRestore?.token ?? 0) + "-" + advisorRunId} materials={pool} lang={lang} suspended={presentation || !paretoVisible || restoringSession || isLoadingData} restored={modules.pareto?.workflowShared ? { token: advisorRunId + 1000, value: modules.pareto } : restoredPareto} onState={onParetoState} onSelect={chooseCandidate} onObserve={syncObservations} /></React.Suspense>}</details>
      <details className="workflow-card"><summary>{tx("我的研究 · 保存、导出与恢复", "My research · save, export & restore")}</summary><ResearchControls capture={captureResearch} onRestore={restoreResearch} onPresent={presentResearch} busy={isLoadingData || restoringSession} /></details>
      {expert && <section className="workflow-card"><label>{tx("查找材料", "Find a material")}<input value={materialSearch} onChange={e => setMaterialSearch(e.target.value)} placeholder={tx("化学式或材料 ID", "Formula or material ID")} /></label><div className="workflow-actions">{pool.filter(m => (m.formula + " " + m.id).toLowerCase().includes(materialSearch.toLowerCase())).slice(0, 30).map(m => <button key={m.id} onClick={() => chooseCandidate(materialRecordKey(m))}>{m.formula} · {m.id}</button>)}</div><React.Suspense fallback={null}><DeferredSection label={tx("元素常数", "Element constants")}><CompositionDescriptorPanel materials={pool} lang={lang} /></DeferredSection></React.Suspense></section>}
      <CandidateDetails material={selectedMaterial} modules={modules} report={liveReport} open={showCandidate} onClose={() => setShowCandidate(false)} onAction={(action, material) => void candidateAction(action, material)} />
      <GeometryPanel artifact={geometryArtifact} materials={pool} references={modules.structures} open={showGeometry} onClose={() => setShowGeometry(false)} onApply={applyGeometry} />
      {(advisorOpened || restoredAdvisor) && <React.Suspense fallback={null}><MaterialsAdvisor open={showAdvisor} onClose={() => setShowAdvisor(false)} input={{ pool, state, strategy, batchSize, totalBudget, isRealData, runId: advisorRunId, modelConfig: modelSettings, moduleEvidence, hubMetadata, hubQuery: hubMetadata?.query ?? hubQuery, hubLoadState: isLoadingData ? "loading" : runError && !hubMetadata ? "error" : "ready" }} lang={lang} loading={isLoadingData || isIterating} request={advisorRequest} restored={restoredAdvisor} onState={onAdvisorState} onSelect={id => { const m = pool.find(m => m.id === id); setSelectedRecordKey(m ? materialRecordKey(m) : null); }} /></React.Suspense>}
      {hasOpenedStructure && <StructurePanel key={"structure-" + (sessionRestore?.token ?? 0)} restored={structureRestore} onStructure={rememberStructure} onUseStructure={(structure, action) => void useStructure({ structure, stage: structure.source.recordRef ? "database" : "imported" }, action)} open={showStructure} onClose={() => setShowStructure(false)} lang={lang} materialRequest={structureMaterial} onImportMode={openStructure} onOpenLab={structure => openSynthesisLab(undefined, structure)} />}
      {hasOpenedUmlip && <React.Suspense fallback={<p role="status">{tx("正在打开构型计算…", "Loading configuration calculations…")}</p>}><UmlipPanel key={"umlip-" + (sessionRestore?.token ?? 0)} enqueue={queueRequest} restored={restoredUmlip} onState={onUmlipState} onUseStructure={(draft, action) => void useStructure(draft, action)} open={showUmlip} onClose={() => setShowUmlip(false)} lang={lang} /></React.Suspense>}
      {labPanel}
      {showDocs && <div className="workflow-modal" role="dialog" aria-modal="true" aria-label={tx("研究方法", "Methods")}><article className="workflow-card"><button onClick={() => setShowDocs(false)}>{tx("关闭", "Close")}</button><h2>{tx("研究方法与路线图", "Methods & roadmap")}</h2><h3>{tx("选择、解释、决策、验证", "Select, interpret, decide, verify")}</h3><p>{t.methodologyDesc}</p><p>{t.representationDesc}</p><h3>{tx("验证计划", "Validation plan")}</h3><p>{tx("多种子回溯对照 → 已知体系重发现 → 合作课题组试用 → 推荐候选合成、XRD 与性质验证。", "Multi-seed retrospective comparisons → known-material rediscovery → partner trials → candidate synthesis, XRD and property validation.")}</p><h3>{tx("场景路线图", "Scenario roadmap")}</h3><p>{tx("固态电解质：带隙与稳定性初筛，下一阶段接入离子迁移与界面评价。PCEC/SOFC：建立氧空位与电极性质数据。催化：建立反应条件一致的活性数据。", "Solid electrolytes: band-gap/stability screening, followed by ion migration and interfaces. PCEC/SOFC: vacancy and electrode datasets. Catalysis: activity data under comparable conditions.")}</p></article></div>}
      <footer className="workflow-footer">{tx("问鼎储能 · 数据 → 智能筛选 → 候选报告 → 计算与实验验证", "Wending Energy · Data → AI screening → Candidate reports → Computational & experimental validation")}</footer>
    </div>
  </LanguageContext.Provider>;
}
