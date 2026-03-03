import React, { useState, useEffect, useMemo } from "react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell
} from "recharts";
import { 
  Beaker, 
  Database, 
  Cpu, 
  Zap, 
  Play, 
  RotateCcw, 
  ChevronRight, 
  AlertCircle,
  TrendingUp,
  Layers,
  Search
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { MaterialsEngine } from "./engine/MaterialsEngine";
import { SurrogateModel } from "./engine/SurrogateModel";
import { AcquisitionFunction, AcquisitionStrategy } from "./engine/AcquisitionFunction";
import { Material, ALState, AL_CONFIG } from "./types";

const engine = new MaterialsEngine();
const model = new SurrogateModel();

const translations = {
  en: {
    title: "AMI-AL Research Prototype",
    subtitle: "Materials Active Learning Optimization System v1.0",
    reset: "Reset",
    runLoop: "Run Loop",
    stop: "Stop",
    systemConfig: "System Config",
    acquisitionStrategy: "Acquisition Strategy",
    batchSize: "Batch Size",
    budget: "Budget",
    liveMetrics: "Live Metrics",
    iteration: "Iteration",
    sampledTotal: "Sampled / Total",
    bestConductivity: "Best Conductivity (log)",
    regretCurve: "Optimization Regret Curve",
    searchSpace: "Search Space Exploration",
    recommendations: "Recent Experimental Recommendations",
    formula: "Formula",
    status: "Status",
    predMean: "Pred. Mean",
    uncertainty: "Uncertainty",
    acquisition: "Acquisition",
    trueValue: "True Value",
    methodology: "Methodology",
    representation: "Representation",
    objective: "Objective",
    sampled: "Sampled",
    candidate: "Candidate",
    pending: "Pending",
    iter: "Iter",
    methodologyDesc: "We employ a Bayesian Optimization framework where a surrogate model (Ensemble Regressor) approximates the DFT-calculated ionic conductivity surface. The acquisition function balances exploration (uncertainty) and exploitation (predicted performance).",
    representationDesc: "Materials are featurized using a combination of compositional descriptors (Magpie) and structural motifs. The current prototype uses a 10-dimensional latent space representing chemical environment and lattice stability.",
    objectiveDesc: "Maximize Band Gap to find high-performance insulators. Target: Discover lithium oxides with the highest band gap within a 50-sample budget.",
    langToggle: "中文"
  },
  zh: {
    title: "AMI-AL 研究原型系统",
    subtitle: "材料主动学习优化系统 v1.0",
    reset: "重置",
    runLoop: "运行循环",
    stop: "停止",
    systemConfig: "系统配置",
    acquisitionStrategy: "获取函数策略",
    batchSize: "批次大小",
    budget: "实验预算",
    liveMetrics: "实时指标",
    iteration: "迭代轮次",
    sampledTotal: "已采样 / 总计",
    bestConductivity: "最佳电导率 (log)",
    regretCurve: "优化收敛曲线 (Regret)",
    searchSpace: "搜索空间探索",
    recommendations: "近期实验推荐",
    formula: "化学式",
    status: "状态",
    predMean: "预测均值",
    uncertainty: "不确定性",
    acquisition: "获取函数值",
    trueValue: "真实值",
    methodology: "研究方法",
    representation: "特征表示",
    objective: "优化目标",
    sampled: "已采样",
    candidate: "候选",
    pending: "待定",
    iter: "轮次",
    methodologyDesc: "我们采用贝叶斯优化框架，利用代理模型（集成回归器）逼近 DFT 计算的离子电导率表面。获取函数平衡了探索（不确定性）与利用（预测性能）。",
    representationDesc: "材料通过成分描述符（Magpie）和结构基元进行特征化。当前原型使用 10 维潜空间表示化学环境和晶格稳定性。",
    objectiveDesc: "最大化带隙 (Band Gap)，寻找高性能绝缘体。目标：在 50 个样本的实验预算内发现带隙最大的锂氧化物材料。",
    langToggle: "English"
  }
};

export default function App() {
  const [lang, setLang] = useState<"en" | "zh">("zh");
  const t = translations[lang];

  const [isLoaded, setIsLoaded] = useState(false);
  const [pool, setPool] = useState<Material[]>([]);
  const [strategy, setStrategy] = useState<AcquisitionStrategy>("UCB");
  const [state, setState] = useState<ALState>({
    iteration: 0,
    budget: AL_CONFIG.TOTAL_BUDGET,
    sampledCount: 0,
    bestValue: -Infinity,
    history: [],
  });
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isRealData, setIsRealData] = useState(false);

  useEffect(() => {
    const init = async () => {
      const success = await engine.loadRealData(150);
      setPool(engine.getPool());
      setIsRealData(success);
      setIsLoaded(true);
    };
    init();
  }, []);

  const sampledMaterials = useMemo(() => pool.filter(m => m.isSampled), [pool]);
  const unsampledMaterials = useMemo(() => pool.filter(m => !m.isSampled), [pool]);

  const runIteration = async () => {
    if (state.sampledCount >= AL_CONFIG.TOTAL_BUDGET) return;

    const newState = { ...state };
    const newPool = [...pool];

    // 1. Initial Sampling if iteration 0
    if (state.iteration === 0 && state.sampledCount === 0) {
      const initialIndices = Array.from({ length: AL_CONFIG.INITIAL_SAMPLES }, () => 
        Math.floor(Math.random() * newPool.length)
      );
      initialIndices.forEach(idx => {
        newPool[idx].isSampled = true;
        newPool[idx].iteration = 0;
      });
      newState.sampledCount = AL_CONFIG.INITIAL_SAMPLES;
    }

    // 2. Train Surrogate Model
    const currentSampled = newPool.filter(m => m.isSampled);
    await model.train(currentSampled);

    // 3. Predict on Unsampled Pool
    newPool.forEach(m => {
      if (!m.isSampled) {
        const { mean, std } = model.predict(m);
        m.predictedMean = mean;
        m.predictedStd = std;
      }
    });

    // 4. Compute Acquisition Values
    const currentBest = Math.max(...currentSampled.map(m => m.trueProperty));
    newPool.forEach(m => {
      if (!m.isSampled) {
        m.acquisitionValue = AcquisitionFunction.compute(m, strategy, currentBest);
      }
    });

    // 5. Select Batch (if not initial)
    if (state.iteration > 0 || state.sampledCount > AL_CONFIG.INITIAL_SAMPLES) {
      const candidates = newPool
        .filter(m => !m.isSampled)
        .sort((a, b) => (b.acquisitionValue || 0) - (a.acquisitionValue || 0))
        .slice(0, AL_CONFIG.BATCH_SIZE);

      candidates.forEach(c => {
        c.isSampled = true;
        c.iteration = state.iteration;
      });
      newState.sampledCount += AL_CONFIG.BATCH_SIZE;
    }

    // 6. Update State
    const updatedSampled = newPool.filter(m => m.isSampled);
    const bestVal = Math.max(...updatedSampled.map(m => m.trueProperty));
    const globalMax = engine.getGlobalMax();

    newState.iteration += 1;
    newState.bestValue = bestVal;
    newState.history.push({
      iteration: newState.iteration,
      bestValue: bestVal,
      avgError: 0, // Simplified
      regret: globalMax - bestVal,
    });

    setPool(newPool);
    setState(newState);
  };

  const reset = () => {
    const freshEngine = new MaterialsEngine();
    setPool(freshEngine.getPool());
    setState({
      iteration: 0,
      budget: AL_CONFIG.TOTAL_BUDGET,
      sampledCount: 0,
      bestValue: -Infinity,
      history: [],
    });
    setIsAutoRunning(false);
  };

  useEffect(() => {
    let interval: any;
    if (isAutoRunning && state.sampledCount < AL_CONFIG.TOTAL_BUDGET) {
      interval = setInterval(() => {
        runIteration();
      }, 800);
    } else {
      setIsAutoRunning(false);
    }
    return () => clearInterval(interval);
  }, [isAutoRunning, state.sampledCount]);

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#F5F5F0] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 border-4 border-[#141414] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm font-bold uppercase tracking-widest opacity-60">正在对接 Materials Project 数据库...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F0] text-[#141414] font-sans p-6">
      {/* Header */}
      <header className="max-w-7xl mx-auto mb-8 flex justify-between items-end border-b border-[#141414]/10 pb-4">
        <div>
          <h1 className="text-4xl font-serif italic font-medium tracking-tight">
            {t.title}
          </h1>
          <p className="text-sm opacity-60 uppercase tracking-widest mt-2">
            {t.subtitle}
          </p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setLang(lang === "en" ? "zh" : "en")}
            className="flex items-center gap-2 px-4 py-2 border border-[#141414]/20 hover:bg-[#141414]/5 transition-colors text-xs uppercase font-bold tracking-tighter rounded-lg"
          >
            {t.langToggle}
          </button>
          <button 
            onClick={reset}
            className="flex items-center gap-2 px-4 py-2 border border-[#141414] hover:bg-[#141414] hover:text-[#F5F5F0] transition-colors text-xs uppercase font-bold tracking-tighter"
          >
            <RotateCcw size={14} /> {t.reset}
          </button>
          <button 
            onClick={() => setIsAutoRunning(!isAutoRunning)}
            disabled={state.sampledCount >= AL_CONFIG.TOTAL_BUDGET}
            className={`flex items-center gap-2 px-6 py-2 ${isAutoRunning ? 'bg-red-500 text-white border-red-500' : 'bg-[#141414] text-[#F5F5F0]'} border border-[#141414] transition-colors text-xs uppercase font-bold tracking-tighter disabled:opacity-30`}
          >
            {isAutoRunning ? <><AlertCircle size={14} /> {t.stop}</> : <><Play size={14} /> {t.runLoop}</>}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-12 gap-8">
        {/* Sidebar: Config & Stats */}
        <div className="col-span-3 space-y-6">
          <section className="bg-white p-6 rounded-3xl shadow-sm border border-[#141414]/5">
            <h3 className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4 flex items-center gap-2">
              <Database size={14} /> 数据概况
            </h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold opacity-60">数据源</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isRealData ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                  {isRealData ? 'Materials Project' : '模拟数据 (Mock)'}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold opacity-60">样本总量</span>
                <span className="text-sm font-mono font-bold">{pool.length}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold opacity-60">特征维度</span>
                <span className="text-sm font-mono font-bold">{pool[0]?.features.length || 0}</span>
              </div>
              {!isRealData && (
                <div className="mt-4 p-3 bg-orange-50 rounded-xl border border-orange-100">
                  <p className="text-[9px] text-orange-800 leading-tight">
                    提示：未检测到 MP_API_KEY。请在环境变量中配置以启用真实 DFT 数据对接。
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="bg-white p-6 rounded-3xl shadow-sm border border-[#141414]/5">
            <h3 className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4 flex items-center gap-2">
              <Layers size={14} /> {t.systemConfig}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold opacity-60">{t.acquisitionStrategy}</label>
                <select 
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as AcquisitionStrategy)}
                  className="w-full mt-1 bg-[#F5F5F0] border-none rounded-lg p-2 text-sm font-medium focus:ring-1 focus:ring-[#141414]"
                >
                  <option value="UCB">{lang === 'en' ? 'Upper Confidence Bound (UCB)' : '上置信界 (UCB)'}</option>
                  <option value="EI">{lang === 'en' ? 'Expected Improvement (EI)' : '期望改进 (EI)'}</option>
                  <option value="Uncertainty">{lang === 'en' ? 'Uncertainty Sampling' : '不确定性采样'}</option>
                  <option value="Random">{lang === 'en' ? 'Random (Baseline)' : '随机采样 (基准)'}</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] uppercase font-bold opacity-60">{t.batchSize}</p>
                  <p className="text-xl font-serif italic">{AL_CONFIG.BATCH_SIZE}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold opacity-60">{t.budget}</p>
                  <p className="text-xl font-serif italic">{AL_CONFIG.TOTAL_BUDGET}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-[#141414] text-[#F5F5F0] p-6 rounded-3xl shadow-xl">
            <h3 className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4 flex items-center gap-2">
              <TrendingUp size={14} /> {t.liveMetrics}
            </h3>
            <div className="space-y-6">
              <div>
                <p className="text-[10px] uppercase font-bold opacity-40">{t.iteration}</p>
                <p className="text-4xl font-serif italic">{state.iteration}</p>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold opacity-40">{t.sampledTotal}</p>
                <div className="flex items-end gap-2">
                  <p className="text-3xl font-serif italic">{state.sampledCount}</p>
                  <p className="text-sm opacity-40 mb-1">/ {AL_CONFIG.TOTAL_BUDGET}</p>
                </div>
                <div className="w-full bg-white/10 h-1 mt-2 rounded-full overflow-hidden">
                  <motion.div 
                    className="bg-emerald-400 h-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${(state.sampledCount / AL_CONFIG.TOTAL_BUDGET) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold opacity-40">{t.bestConductivity}</p>
                <p className="text-3xl font-serif italic text-emerald-400">
                  {state.bestValue === -Infinity ? "N/A" : state.bestValue.toFixed(4)}
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Main Content: Visualization */}
        <div className="col-span-9 space-y-8">
          {/* Charts Row */}
          <div className="grid grid-cols-2 gap-8">
            <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 h-[350px]">
              <h3 className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4">{t.regretCurve}</h3>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={state.history}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#14141410" />
                  <XAxis dataKey="iteration" hide />
                  <YAxis label={{ value: lang === 'en' ? 'Regret' : '遗憾值', angle: -90, position: 'insideLeft', style: { fontSize: 10, fontWeight: 'bold' } }} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="regret" 
                    stroke="#141414" 
                    strokeWidth={3} 
                    dot={{ r: 4, fill: '#141414' }} 
                    activeDot={{ r: 6 }}
                    animationDuration={300}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white p-6 rounded-3xl border border-[#141414]/5 h-[350px]">
              <h3 className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4">{t.searchSpace}</h3>
              <ResponsiveContainer width="100%" height="90%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#14141410" />
                  <XAxis type="number" dataKey="x" hide />
                  <YAxis type="number" dataKey="y" hide />
                  <ZAxis type="number" dataKey="z" range={[20, 400]} />
                  <Tooltip cursor={{ strokeDasharray: '3 3' }} />
                  <Scatter name={lang === 'en' ? 'Materials' : '材料'} data={pool.map((m, i) => ({
                    x: m.features[0],
                    y: m.features[1],
                    z: m.trueProperty + 5,
                    id: m.id,
                    isSampled: m.isSampled,
                    formula: m.formula
                  }))}>
                    {pool.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.isSampled ? "#10b981" : "#14141410"} 
                        stroke={entry.isSampled ? "#065f46" : "none"}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Data Table / Material List */}
          <div className="bg-white rounded-3xl border border-[#141414]/5 overflow-hidden">
            <div className="p-6 border-b border-[#141414]/5 flex justify-between items-center">
              <h3 className="text-xs font-bold uppercase tracking-widest opacity-40">{t.recommendations}</h3>
              <div className="flex gap-2">
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 bg-emerald-100 text-emerald-700 rounded-full">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> {t.sampled}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 bg-gray-100 text-gray-500 rounded-full">
                  {t.candidate}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#F5F5F0]/50">
                    <th className="p-4 text-[10px] uppercase font-bold opacity-40">{t.formula}</th>
                    <th className="p-4 text-[10px] uppercase font-bold opacity-40">{t.status}</th>
                    <th className="p-4 text-[10px] uppercase font-bold opacity-40">{t.predMean}</th>
                    <th className="p-4 text-[10px] uppercase font-bold opacity-40">{t.uncertainty}</th>
                    <th className="p-4 text-[10px] uppercase font-bold opacity-40">{t.acquisition}</th>
                    <th className="p-4 text-[10px] uppercase font-bold opacity-40">{t.trueValue}</th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence mode="popLayout">
                    {pool
                      .filter(m => m.isSampled || (m.acquisitionValue && m.acquisitionValue > 0))
                      .sort((a, b) => {
                        if (a.isSampled && !b.isSampled) return -1;
                        if (!a.isSampled && b.isSampled) return 1;
                        return (b.acquisitionValue || 0) - (a.acquisitionValue || 0);
                      })
                      .slice(0, 8)
                      .map((m) => (
                        <motion.tr 
                          layout
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.95 }}
                          key={m.id} 
                          className={`border-b border-[#141414]/5 hover:bg-[#F5F5F0]/30 transition-colors ${m.isSampled ? 'bg-emerald-50/30' : ''}`}
                        >
                          <td className="p-4 font-serif italic text-lg">{m.formula}</td>
                          <td className="p-4">
                            {m.isSampled ? (
                              <span className="text-[10px] font-bold uppercase text-emerald-600">{t.iter} {m.iteration}</span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase opacity-30">{t.pending}</span>
                            )}
                          </td>
                          <td className="p-4 font-mono text-xs">{m.predictedMean?.toFixed(3) || "—"}</td>
                          <td className="p-4 font-mono text-xs">{m.predictedStd?.toFixed(3) || "—"}</td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className="w-12 bg-gray-100 h-1.5 rounded-full overflow-hidden">
                                <div 
                                  className="bg-[#141414] h-full" 
                                  style={{ width: `${Math.min(100, (m.acquisitionValue || 0) * 20)}%` }} 
                                />
                              </div>
                              <span className="font-mono text-[10px]">{m.acquisitionValue?.toFixed(2) || "0.00"}</span>
                            </div>
                          </td>
                          <td className="p-4 font-mono text-xs font-bold">
                            {m.isSampled ? m.trueProperty.toFixed(4) : "???"}
                          </td>
                        </motion.tr>
                      ))}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      {/* Research Methodology Modal / Info */}
      <footer className="max-w-7xl mx-auto mt-12 grid grid-cols-3 gap-8 border-t border-[#141414]/10 pt-8 pb-12">
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Beaker size={14} /> {t.methodology}
          </h4>
          <p className="text-xs opacity-60 leading-relaxed">
            {t.methodologyDesc}
          </p>
        </div>
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Cpu size={14} /> {t.representation}
          </h4>
          <p className="text-xs opacity-60 leading-relaxed">
            {t.representationDesc}
          </p>
        </div>
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-widest flex items-center gap-2">
            <Zap size={14} /> {t.objective}
          </h4>
          <p className="text-xs opacity-60 leading-relaxed">
            {t.objectiveDesc}
          </p>
        </div>
      </footer>
    </div>
  );
}
