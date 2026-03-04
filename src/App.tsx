import React, { useState, useEffect, useMemo } from "react";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  ScatterChart, Scatter, ZAxis, Cell
} from "recharts";
import { 
  Beaker, 
  Database, 
  Cpu, 
  Play, 
  RotateCcw, 
  ChevronRight, 
  AlertCircle,
  TrendingUp,
  Layers,
  Search,
  FileText,
  X,
  Palette,
  Zap
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
    langToggle: "中文",
    docs: "Documentation",
    docsTitle: "System Documentation & Technical Specifications",
    close: "Close"
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
    langToggle: "English",
    docs: "系统文档",
    docsTitle: "系统文档与技术规范",
    close: "关闭",
    themeClassic: "经典模式",
    themeScience: "科研蓝",
    perfMode: "性能模式"
  }
};

export default function App() {
  const [lang, setLang] = useState<"en" | "zh">("zh");
  const t = translations[lang];

  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [pool, setPool] = useState<Material[]>([]);
  const [strategy, setStrategy] = useState<AcquisitionStrategy>("UCB");
  
  // Dynamic Configs
  const [batchSize, setBatchSize] = useState(AL_CONFIG.BATCH_SIZE);
  const [totalBudget, setTotalBudget] = useState(AL_CONFIG.TOTAL_BUDGET);
  const [searchSpaceSize, setSearchSpaceSize] = useState(400);

  const [state, setState] = useState<ALState>({
    iteration: 0,
    budget: AL_CONFIG.TOTAL_BUDGET,
    sampledCount: 0,
    bestValue: -Infinity,
    history: [],
  });
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [isRealData, setIsRealData] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [theme, setTheme] = useState<'classic' | 'science'>('classic');

  const loadData = async (size: number) => {
    setIsLoadingData(true);
    const success = await engine.loadRealData(size);
    setPool(engine.getPool());
    setIsRealData(success);
    setIsLoadingData(false);
    setIsLoaded(true);
  };

  useEffect(() => {
    loadData(searchSpaceSize);
  }, []);

  // Performance-optimized chart data (downsampling for large datasets)
  const chartData = useMemo(() => {
    if (pool.length <= 2000) return pool;
    // If pool is large, show all sampled + a random sample of unsampled to keep 2000 points max
    const sampled = pool.filter(m => m.isSampled);
    const unsampled = pool.filter(m => !m.isSampled);
    const sampleRate = Math.max(0.05, 2000 / unsampled.length);
    const sampledUnsampled = unsampled.filter(() => Math.random() < sampleRate);
    return [...sampled, ...sampledUnsampled];
  }, [pool]);

  const runIteration = async () => {
    if (state.sampledCount >= totalBudget) return;

    // Deep clone state and pool to avoid "object is not extensible" errors
    const newState = { 
      ...state, 
      history: [...state.history] 
    };
    // Map to new objects to ensure they are extensible
    const newPool = pool.map(m => ({ ...m }));

    // 1. Initial Sampling if iteration 0
    if (state.iteration === 0 && state.sampledCount === 0) {
      const initialIndices: number[] = [];
      while (initialIndices.length < AL_CONFIG.INITIAL_SAMPLES) {
        const idx = Math.floor(Math.random() * newPool.length);
        if (!initialIndices.includes(idx)) initialIndices.push(idx);
      }
      
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
        .slice(0, batchSize);

      candidates.forEach(c => {
        c.isSampled = true;
        c.iteration = state.iteration;
      });
      newState.sampledCount += batchSize;
    }

    // 6. Update State
    const updatedSampled = newPool.filter(m => m.isSampled);
    const bestVal = Math.max(...updatedSampled.map(m => m.trueProperty));
    const globalMax = engine.getGlobalMax();

    newState.iteration += 1;
    newState.bestValue = bestVal;
    
    // Calculate regret with higher precision to avoid premature 0
    const currentRegret = globalMax - bestVal;
    
    newState.history.push({
      iteration: newState.iteration,
      bestValue: bestVal,
      avgError: 0, 
      regret: currentRegret > 1e-6 ? currentRegret : 0,
    });

    setPool(newPool);
    setState(newState);
  };

  const reset = () => {
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
    setState({
      iteration: 0,
      budget: totalBudget,
      sampledCount: 0,
      bestValue: -Infinity,
      history: [],
    });
    setIsAutoRunning(false);
  };

  useEffect(() => {
    let interval: any;
    if (isAutoRunning && state.sampledCount < totalBudget) {
      interval = setInterval(() => {
        runIteration();
      }, 800);
    } else {
      setIsAutoRunning(false);
    }
    return () => clearInterval(interval);
  }, [isAutoRunning, state.sampledCount, totalBudget]);

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
    <div className={`min-h-screen ${theme === 'classic' ? 'bg-[#F5F5F0] text-[#141414]' : 'bg-[#F0F4F8] text-[#1A365D]'} font-sans transition-colors duration-500 p-6`}>
      {/* Header */}
      <header className={`max-w-7xl mx-auto mb-8 flex justify-between items-end border-b ${theme === 'classic' ? 'border-[#141414]/10' : 'border-[#2B6CB0]/20'} pb-4`}>
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
            onClick={() => setTheme(theme === 'classic' ? 'science' : 'classic')}
            className={`flex items-center gap-2 px-4 py-2 border ${theme === 'classic' ? 'border-[#141414]/20 hover:bg-[#141414]/5' : 'border-[#2B6CB0]/30 hover:bg-[#2B6CB0]/5 text-[#2B6CB0]'} transition-colors text-xs uppercase font-bold tracking-tighter rounded-lg`}
          >
            <Palette size={14} /> {theme === 'classic' ? t.themeScience : t.themeClassic}
          </button>
          <button 
            onClick={() => setShowDocs(true)}
            className={`flex items-center gap-2 px-4 py-2 border ${theme === 'classic' ? 'border-[#141414]/20 hover:bg-[#141414]/5' : 'border-[#2B6CB0]/30 hover:bg-[#2B6CB0]/5 text-[#2B6CB0]'} transition-colors text-xs uppercase font-bold tracking-tighter rounded-lg`}
          >
            <FileText size={14} /> {t.docs}
          </button>
          <button 
            onClick={() => setLang(lang === "en" ? "zh" : "en")}
            className={`flex items-center gap-2 px-4 py-2 border ${theme === 'classic' ? 'border-[#141414]/20 hover:bg-[#141414]/5' : 'border-[#2B6CB0]/30 hover:bg-[#2B6CB0]/5 text-[#2B6CB0]'} transition-colors text-xs uppercase font-bold tracking-tighter rounded-lg`}
          >
            {t.langToggle}
          </button>
          <button 
            onClick={reset}
            className={`flex items-center gap-2 px-4 py-2 border ${theme === 'classic' ? 'border-[#141414] hover:bg-[#141414] hover:text-[#F5F5F0]' : 'border-[#2B6CB0] text-[#2B6CB0] hover:bg-[#2B6CB0] hover:text-white'} transition-colors text-xs uppercase font-bold tracking-tighter`}
          >
            <RotateCcw size={14} /> {t.reset}
          </button>
          <button 
            onClick={() => setIsAutoRunning(!isAutoRunning)}
            disabled={state.sampledCount >= totalBudget}
            className={`flex items-center gap-2 px-6 py-2 ${isAutoRunning ? 'bg-red-500 text-white border-red-500' : (theme === 'classic' ? 'bg-[#141414] text-[#F5F5F0]' : 'bg-[#2B6CB0] text-white')} border border-transparent transition-colors text-xs uppercase font-bold tracking-tighter disabled:opacity-30`}
          >
            {isAutoRunning ? <><AlertCircle size={14} /> {t.stop}</> : <><Play size={14} /> {t.runLoop}</>}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto grid grid-cols-12 gap-8">
        {/* Sidebar: Config & Stats */}
        <div className="col-span-3 space-y-6">
          <section className={`${theme === 'classic' ? 'bg-white' : 'bg-white/80'} p-6 rounded-3xl shadow-sm border ${theme === 'classic' ? 'border-[#141414]/5' : 'border-[#2B6CB0]/10'}`}>
            <h3 className={`text-xs font-bold uppercase tracking-widest opacity-40 mb-4 flex items-center gap-2 ${theme === 'science' ? 'text-[#2B6CB0]' : ''}`}>
              <Database size={14} /> 数据概况
            </h3>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-[10px] uppercase font-bold opacity-60">数据源</span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${isRealData ? (theme === 'classic' ? 'bg-blue-100 text-blue-700' : 'bg-blue-600 text-white') : 'bg-orange-100 text-orange-700'}`}>
                  {isRealData ? 'Materials Project' : '模拟数据 (Mock)'}
                </span>
              </div>
              
              <div>
                <div className="flex justify-between">
                  <label className="text-[10px] uppercase font-bold opacity-60">搜索空间规模</label>
                  <span className="text-[10px] font-mono font-bold">{searchSpaceSize}</span>
                </div>
                <input 
                  type="range" min="100" max="10000" step="100"
                  value={searchSpaceSize}
                  onChange={(e) => setSearchSpaceSize(parseInt(e.target.value))}
                  disabled={state.iteration > 0 || isLoadingData}
                  className={`w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer ${theme === 'classic' ? 'accent-[#141414]' : 'accent-[#2B6CB0]'} mt-2`}
                />
                <button 
                  onClick={() => loadData(searchSpaceSize)}
                  disabled={state.iteration > 0 || isLoadingData}
                  className={`w-full mt-3 py-1.5 border ${theme === 'classic' ? 'border-[#141414] hover:bg-[#141414] hover:text-white' : 'border-[#2B6CB0] text-[#2B6CB0] hover:bg-[#2B6CB0] hover:text-white'} text-[10px] font-bold uppercase tracking-tighter transition-all disabled:opacity-20`}
                >
                  {isLoadingData ? '正在同步...' : '同步数据 (Sync Data)'}
                </button>
              </div>

              <div className="pt-2 border-t border-gray-100 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase font-bold opacity-60">特征维度</span>
                  <span className="text-sm font-mono font-bold">{pool[0]?.features.length || 0}</span>
                </div>
                {pool.length > 2000 && (
                  <div className="flex items-center gap-1 text-[9px] text-emerald-600 font-bold uppercase">
                    <Zap size={10} /> {t.perfMode}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className={`${theme === 'classic' ? 'bg-white' : 'bg-white/80'} p-6 rounded-3xl shadow-sm border ${theme === 'classic' ? 'border-[#141414]/5' : 'border-[#2B6CB0]/10'}`}>
            <h3 className={`text-xs font-bold uppercase tracking-widest opacity-40 mb-4 flex items-center gap-2 ${theme === 'science' ? 'text-[#2B6CB0]' : ''}`}>
              <Layers size={14} /> {t.systemConfig}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold opacity-60">{t.acquisitionStrategy}</label>
                <select 
                  value={strategy}
                  onChange={(e) => setStrategy(e.target.value as AcquisitionStrategy)}
                  className={`w-full mt-1 ${theme === 'classic' ? 'bg-[#F5F5F0]' : 'bg-blue-50'} border-none rounded-lg p-2 text-sm font-medium focus:ring-1 ${theme === 'classic' ? 'focus:ring-[#141414]' : 'focus:ring-[#2B6CB0]'}`}
                >
                  <option value="UCB">{lang === 'en' ? 'Upper Confidence Bound (UCB)' : '上置信界 (UCB)'}</option>
                  <option value="EI">{lang === 'en' ? 'Expected Improvement (EI)' : '期望改进 (EI)'}</option>
                  <option value="Uncertainty">{lang === 'en' ? 'Uncertainty Sampling' : '不确定性采样'}</option>
                  <option value="Random">{lang === 'en' ? 'Random (Baseline)' : '随机采样 (基准)'}</option>
                </select>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <div className="flex justify-between">
                    <label className="text-[10px] uppercase font-bold opacity-60">{t.batchSize}</label>
                    <span className="text-[10px] font-mono font-bold">{batchSize}</span>
                  </div>
                  <input 
                    type="range" min="1" max="20" step="1"
                    value={batchSize}
                    onChange={(e) => setBatchSize(parseInt(e.target.value))}
                    disabled={state.iteration > 0}
                    className={`w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer ${theme === 'classic' ? 'accent-[#141414]' : 'accent-[#2B6CB0]'} mt-2`}
                  />
                </div>
                <div>
                  <div className="flex justify-between">
                    <label className="text-[10px] uppercase font-bold opacity-60">{t.budget}</label>
                    <span className="text-[10px] font-mono font-bold">{totalBudget}</span>
                  </div>
                  <input 
                    type="range" min="10" max="200" step="10"
                    value={totalBudget}
                    onChange={(e) => setTotalBudget(parseInt(e.target.value))}
                    disabled={state.iteration > 0}
                    className={`w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer ${theme === 'classic' ? 'accent-[#141414]' : 'accent-[#2B6CB0]'} mt-2`}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className={`${theme === 'classic' ? 'bg-[#141414] text-[#F5F5F0]' : 'bg-[#1A365D] text-white'} p-6 rounded-3xl shadow-xl`}>
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
                  <p className="text-sm opacity-40 mb-1">/ {totalBudget}</p>
                </div>
                <div className="w-full bg-white/10 h-1 mt-2 rounded-full overflow-hidden">
                  <motion.div 
                    className={theme === 'classic' ? "bg-emerald-400 h-full" : "bg-teal-400 h-full"}
                    initial={{ width: 0 }}
                    animate={{ width: `${(state.sampledCount / totalBudget) * 100}%` }}
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase font-bold opacity-40">{t.bestConductivity}</p>
                <p className={`text-3xl font-serif italic ${theme === 'classic' ? 'text-emerald-400' : 'text-teal-300'}`}>
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
            <div className={`${theme === 'classic' ? 'bg-white' : 'bg-white/80'} p-6 rounded-3xl border ${theme === 'classic' ? 'border-[#141414]/5' : 'border-[#2B6CB0]/10'} h-[350px]`}>
              <h3 className={`text-xs font-bold uppercase tracking-widest opacity-40 mb-4 ${theme === 'science' ? 'text-[#2B6CB0]' : ''}`}>{t.regretCurve}</h3>
              <ResponsiveContainer width="100%" height="90%">
                <LineChart data={state.history}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'classic' ? "#14141410" : "#2B6CB010"} />
                  <XAxis dataKey="iteration" hide />
                  <YAxis strokeOpacity={0.4} fontSize={10} tickFormatter={(val) => val.toFixed(2)} />
                  <Tooltip 
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="regret" 
                    stroke={theme === 'classic' ? "#141414" : "#2B6CB0"} 
                    strokeWidth={3} 
                    dot={{ r: 4, fill: theme === 'classic' ? "#141414" : "#2B6CB0" }} 
                    activeDot={{ r: 6 }}
                    animationDuration={300}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className={`${theme === 'classic' ? 'bg-white' : 'bg-white/80'} p-6 rounded-3xl border ${theme === 'classic' ? 'border-[#141414]/5' : 'border-[#2B6CB0]/10'} h-[350px]`}>
              <h3 className={`text-xs font-bold uppercase tracking-widest opacity-40 mb-4 ${theme === 'science' ? 'text-[#2B6CB0]' : ''}`}>{t.searchSpace}</h3>
              <ResponsiveContainer width="100%" height="90%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'classic' ? "#14141410" : "#2B6CB010"} />
                  <XAxis type="number" dataKey="features[0]" hide />
                  <YAxis type="number" dataKey="features[1]" hide />
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const data = payload[0].payload as Material;
                        return (
                          <div className={`${theme === 'classic' ? 'bg-[#141414] text-white' : 'bg-[#1A365D] text-white'} p-4 rounded-2xl shadow-2xl border-none text-[10px] space-y-1 backdrop-blur-md bg-opacity-90`}>
                            <p className="font-bold uppercase tracking-widest opacity-50 mb-2">{data.formula}</p>
                            <p>Band Gap: <span className="font-mono text-emerald-400">{data.trueProperty.toFixed(3)} eV</span></p>
                            {data.predictedMean && <p>Pred: <span className="font-mono text-blue-300">{data.predictedMean.toFixed(3)} eV</span></p>}
                            {data.predictedStd && <p>Unc: <span className="font-mono text-orange-300">{data.predictedStd.toFixed(3)}</span></p>}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Scatter 
                    name="Unsampled" 
                    data={chartData.filter(m => !m.isSampled)} 
                    fill={theme === 'classic' ? "#141414" : "#2B6CB0"} 
                    fillOpacity={0.05} 
                  />
                  <Scatter 
                    name="Sampled" 
                    data={chartData.filter(m => m.isSampled)} 
                    fill={theme === 'classic' ? "#10B981" : "#38B2AC"} 
                  >
                    {chartData.filter(m => m.isSampled).map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={entry.trueProperty === state.bestValue ? (theme === 'classic' ? "#F59E0B" : "#F6AD55") : (theme === 'classic' ? "#10B981" : "#38B2AC")} 
                        stroke="#fff" 
                        strokeWidth={2}
                      />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Data Table / Material List */}
          <div className={`${theme === 'classic' ? 'bg-white' : 'bg-white/90'} rounded-3xl border ${theme === 'classic' ? 'border-[#141414]/5' : 'border-[#2B6CB0]/10'} overflow-hidden`}>
            <div className={`p-6 border-b ${theme === 'classic' ? 'border-[#141414]/5' : 'border-[#2B6CB0]/10'} flex justify-between items-center`}>
              <h3 className={`text-xs font-bold uppercase tracking-widest opacity-40 ${theme === 'science' ? 'text-[#2B6CB0]' : ''}`}>{t.recommendations}</h3>
              <div className="flex gap-2">
                <span className={`flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 ${theme === 'classic' ? 'bg-emerald-100 text-emerald-700' : 'bg-teal-100 text-teal-700'} rounded-full`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${theme === 'classic' ? 'bg-emerald-500' : 'bg-teal-500'} animate-pulse`} /> {t.sampled}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-bold uppercase px-2 py-1 bg-gray-100 text-gray-500 rounded-full">
                  {t.candidate}
                </span>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className={theme === 'classic' ? "bg-[#F5F5F0]/50" : "bg-blue-50/50"}>
                    <th className="p-4 text-[10px] uppercase font-bold opacity-40">ID</th>
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
                          className={`border-b border-[#141414]/5 hover:bg-[#F5F5F0]/30 transition-colors ${m.isSampled ? (theme === 'classic' ? 'bg-emerald-50/30' : 'bg-teal-50/30') : ''}`}
                        >
                          <td className="p-4 font-mono text-[10px] opacity-40">{m.id}</td>
                          <td className="p-4 font-serif italic text-lg">{m.formula}</td>
                          <td className="p-4">
                            {m.isSampled ? (
                              <span className={`text-[10px] font-bold uppercase ${theme === 'classic' ? 'text-emerald-600' : 'text-teal-600'}`}>{t.iter} {m.iteration}</span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase opacity-30">{t.pending}</span>
                            )}
                          </td>
                          <td className="p-4 font-mono text-xs">{m.predictedMean?.toFixed(3) || "—"}</td>
                          <td className="p-4 font-mono text-xs">{m.predictedStd?.toFixed(3) || "—"}</td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <div className={`w-12 ${theme === 'classic' ? 'bg-gray-100' : 'bg-blue-100'} h-1.5 rounded-full overflow-hidden`}>
                                <div 
                                  className={`${theme === 'classic' ? 'bg-[#141414]' : 'bg-[#2B6CB0]'} h-full`} 
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
      <footer className={`max-w-7xl mx-auto mt-12 grid grid-cols-3 gap-8 border-t ${theme === 'classic' ? 'border-[#141414]/10' : 'border-[#2B6CB0]/20'} pt-8 pb-12`}>
        <div className="space-y-2">
          <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${theme === 'science' ? 'text-[#2B6CB0]' : ''}`}>
            <Beaker size={14} /> {t.methodology}
          </h4>
          <p className="text-xs opacity-60 leading-relaxed">
            {t.methodologyDesc}
          </p>
        </div>
        <div className="space-y-2">
          <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${theme === 'science' ? 'text-[#2B6CB0]' : ''}`}>
            <Cpu size={14} /> {t.representation}
          </h4>
          <p className="text-xs opacity-60 leading-relaxed">
            {t.representationDesc}
          </p>
        </div>
        <div className="space-y-2">
          <h4 className={`text-xs font-bold uppercase tracking-widest flex items-center gap-2 ${theme === 'science' ? 'text-[#2B6CB0]' : ''}`}>
            <Zap size={14} /> {t.objective}
          </h4>
          <p className="text-xs opacity-60 leading-relaxed">
            {t.objectiveDesc}
          </p>
        </div>
      </footer>

      {/* Documentation Modal */}
      <AnimatePresence>
        {showDocs && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#141414]/40 backdrop-blur-sm p-6"
            onClick={() => setShowDocs(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-4xl max-h-[85vh] rounded-[32px] shadow-2xl overflow-hidden flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-8 border-b border-gray-100 flex justify-between items-center">
                <div>
                  <h2 className="text-2xl font-serif italic font-medium">{t.docsTitle}</h2>
                  <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">Version 1.2.0 • Materials Active Learning Framework</p>
                </div>
                <button 
                  onClick={() => setShowDocs(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X size={20} />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-8 space-y-10">
                {lang === 'en' ? (
                  <>
                    <section className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">01. System Overview</h3>
                      <p className="text-sm leading-relaxed opacity-70">
                        The AMI-AL (Accelerated Materials Innovation - Active Learning) prototype is a closed-loop optimization system designed to accelerate the discovery of high-performance materials. By integrating real-world data from the Materials Project with Bayesian Optimization, the system minimizes the number of expensive "experiments" (DFT calculations) required to find optimal candidates.
                      </p>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">02. Technical Architecture</h3>
                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold uppercase">Surrogate Model</h4>
                          <p className="text-xs opacity-60 leading-relaxed">
                            We utilize an <strong>Ensemble of Regressors</strong> with bootstrap sampling. This approach provides not only a point prediction (Mean) but also a measure of epistemic uncertainty (Standard Deviation), which is crucial for the exploration-exploitation trade-off.
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold uppercase">Acquisition Functions</h4>
                          <p className="text-xs opacity-60 leading-relaxed">
                            <strong>UCB:</strong> Balances mean and variance using a tunable parameter κ.<br/>
                            <strong>EI:</strong> Calculates the expected improvement over the current best observation.<br/>
                            <strong>Uncertainty:</strong> Pure exploration focusing on high-variance regions.
                          </p>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">03. Data Pipeline</h3>
                      <p className="text-sm leading-relaxed opacity-70">
                        The system interfaces with <strong>Materials Project API v2</strong>. Materials are featurized using a 10-dimensional vector representing atomic fractions of key elements (Li, O, P, S, Ge, Sn, La, Zr) combined with normalized electronic properties.
                      </p>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">04. Usage Instructions</h3>
                      <ul className="space-y-3 text-xs opacity-70 list-disc pl-4">
                        <li><strong>Initialization:</strong> Set the Search Space Size (up to 10,000) and click "Sync Data" to fetch real materials.</li>
                        <li><strong>Configuration:</strong> Adjust Batch Size (samples per iteration) and Total Budget (max experiments).</li>
                        <li><strong>Execution:</strong> Use "Run Loop" for automated optimization or "Run Iteration" (implied) for step-by-step control.</li>
                        <li><strong>Analysis:</strong> Monitor the Regret Curve to ensure convergence and the Search Space map to see exploration patterns.</li>
                      </ul>
                    </section>
                  </>
                ) : (
                  <>
                    <section className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">01. 系统概述</h3>
                      <p className="text-sm leading-relaxed opacity-70">
                        AMI-AL（加速材料创新 - 主动学习）原型系统是一个闭环优化系统，旨在加速高性能材料的发现。通过将来自 Materials Project 的真实数据与贝叶斯优化相结合，该系统最大限度地减少了寻找最优候选材料所需的昂贵“实验”（DFT 计算）次数。
                      </p>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">02. 技术架构</h3>
                      <div className="grid grid-cols-2 gap-8">
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold uppercase">代理模型 (Surrogate Model)</h4>
                          <p className="text-xs opacity-60 leading-relaxed">
                            我们采用带自助采样（Bootstrap）的<strong>集成回归器 (Ensemble Regressor)</strong>。这种方法不仅提供点预测（均值），还提供认知不确定性（标准差）的度量，这对于平衡探索与利用至0重要。
                          </p>
                        </div>
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold uppercase">获取函数 (Acquisition Functions)</h4>
                          <p className="text-xs opacity-60 leading-relaxed">
                            <strong>UCB (上置信界):</strong> 使用可调参数 κ 平衡均值和方差。<br/>
                            <strong>EI (期望改进):</strong> 计算相对于当前最佳观测值的期望改进量。<br/>
                            <strong>不确定性采样:</strong> 纯探索策略，专注于高方差区域。
                          </p>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">03. 数据流水线</h3>
                      <p className="text-sm leading-relaxed opacity-70">
                        系统对接 <strong>Materials Project API v2</strong>。材料通过 10 维向量进行特征化，表示关键元素（Li, O, P, S, Ge, Sn, La, Zr）的原子分数，并结合归一化的电子性质。
                      </p>
                    </section>

                    <section className="space-y-4">
                      <h3 className="text-sm font-bold uppercase tracking-widest text-emerald-600">04. 使用说明</h3>
                      <ul className="space-y-3 text-xs opacity-70 list-disc pl-4">
                        <li><strong>初始化:</strong> 设置搜索空间规模（最高 10,000）并点击“同步数据”以获取真实材料。</li>
                        <li><strong>配置:</strong> 调整批次大小（每次迭代采样的样本数）和总预算（最大实验次数）。</li>
                        <li><strong>执行:</strong> 使用“运行循环”进行自动化优化，或通过重置按钮重新开始实验。</li>
                        <li><strong>分析:</strong> 监控遗憾曲线 (Regret Curve) 以确保收敛，并通过搜索空间图观察探索模式。</li>
                      </ul>
                    </section>
                  </>
                )}
              </div>

              <div className="p-8 bg-gray-50 border-t border-gray-100 flex justify-end">
                <button 
                  onClick={() => setShowDocs(false)}
                  className="px-8 py-3 bg-[#141414] text-white text-xs font-bold uppercase tracking-widest rounded-xl hover:bg-black transition-colors"
                >
                  {t.close}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
