import React, { useState, useEffect, useMemo } from 'react';
import { createSeededRandom } from '../engine/SeededRandom';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { Play, RotateCcw, Zap, Target, BarChart2, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import MethodNote from './MethodNote';

interface SimulationPoint {
  step: number;
  random: number;
  gpbo: number;
  amial: number;
}

export const BenchmarkSimulator: React.FC<{ lang: 'en' | 'zh' }> = ({ lang }) => {
  const [isSimulating, setIsSimulating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [data, setData] = useState<SimulationPoint[]>([]);
  const maxSteps = 100;

  const t = {
    en: {
      title: "Strategy Illustration",
      subtitle: "Reproducible strategy-evolution illustration",
      start: "Start Simulation",
      reset: "Reset",
      random: "Random Search",
      gpbo: "Standard GP-BO",
      amial: "AMI-AL (Our System)",
      steps: "Experimental Steps",
      bestValue: "Best Property Found",
      speedupTitle: "Strategy comparison",
      vsRandom: "vs Random Search",
      vsGPBO: "vs Standard GP-BO",
      desc: "These curves use scripted random increments, not fitted surrogate models. They do not establish discovery speedup. Use the model Worker validation page and benchmark:models for measured synthetic fit/predict results.",
      targetFound: "Target Found at Step",
      discoveryRate: "Animation progress"
    },
    zh: {
      title: "策略示意",
      subtitle: "用可重复的曲线，直观理解策略演进",
      start: "开始模拟",
      reset: "重置",
      random: "随机搜索 (Random)",
      gpbo: "标准高斯过程 (GP-BO)",
      amial: "AMI-AL (本系统)",
      steps: "实验步骤",
      bestValue: "发现的最佳性能值",
      speedupTitle: "策略对照评估",
      vsRandom: "对比随机搜索",
      vsGPBO: "对比标准 GP-BO",
      desc: "曲线由预设的随机增量生成，没有调用实际代理模型，不能证明发现加速比。模型 Worker 验证页和 benchmark:models 提供真实合成任务的拟合、预测耗时与误差。",
      targetFound: "目标发现步骤",
      discoveryRate: "动画进度"
    }
  }[lang];

  const generateStep = (step: number, prev: SimulationPoint | null): SimulationPoint => {
    const random = createSeededRandom(0x42454e43 + step);
    // Target is 1.0
    const target = 1.0;
    
    // Random: Slow linear-ish growth
    const randomVal = prev ? Math.max(prev.random, random() * 0.4 + (step / maxSteps) * 0.3) : 0.1;
    
    // GP-BO: Faster logarithmic growth
    const gpboVal = prev ? Math.max(prev.gpbo, Math.min(0.98, prev.gpbo + random() * 0.05 * (1 - prev.gpbo / 1.1))) : 0.2;
    
    // AMI-AL: Fastest sigmoid-like growth
    // Illustration only; no discovery-speedup measurement.
    const amialVal = prev ? Math.max(prev.amial, Math.min(1.0, prev.amial + random() * 0.15 * (1.05 - prev.amial))) : 0.35;

    return {
      step,
      random: parseFloat(randomVal.toFixed(4)),
      gpbo: parseFloat(gpboVal.toFixed(4)),
      amial: parseFloat(amialVal.toFixed(4))
    };
  };

  useEffect(() => {
    let interval: any;
    if (isSimulating && progress < maxSteps) {
      interval = setInterval(() => {
        setProgress(prev => {
          const next = prev + 1;
          setData(current => {
            const last = current.length > 0 ? current[current.length - 1] : null;
            return [...current, generateStep(next, last)];
          });
          return next;
        });
      }, 50);
    } else {
      setIsSimulating(false);
    }
    return () => clearInterval(interval);
  }, [isSimulating, progress]);

  const reset = () => {
    setIsSimulating(false);
    setProgress(0);
    setData([]);
  };

  const metrics = useMemo(() => {
    if (data.length === 0) return { amialStep: 0, gpboStep: 0, randomStep: 0 };
    
    const target = 0.9;
    const amialStep = data.find(p => p.amial >= target)?.step || maxSteps;
    const gpboStep = data.find(p => p.gpbo >= target)?.step || maxSteps;
    const randomStep = data.find(p => p.random >= target)?.step || maxSteps;

    return { amialStep, gpboStep, randomStep };
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-serif italic font-medium flex items-center gap-2">
            <BarChart2 className="text-emerald-600" /> {t.title}
          </h2>
          <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">{t.subtitle}</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={reset}
            className="px-4 py-2 border border-[#141414]/20 hover:bg-gray-100 transition-colors text-[10px] font-bold uppercase tracking-tighter rounded-lg flex items-center gap-2"
          >
            <RotateCcw size={14} /> {t.reset}
          </button>
          <button 
            onClick={() => setIsSimulating(true)}
            disabled={isSimulating || progress >= maxSteps}
            className="px-6 py-2 bg-[#141414] text-white transition-colors text-[10px] font-bold uppercase tracking-tighter rounded-lg flex items-center gap-2 disabled:opacity-30"
          >
            <Play size={14} /> {t.start}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Main Chart */}
        <div className="col-span-8 bg-white p-6 rounded-[32px] border border-[#141414]/5 shadow-sm h-[400px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#14141408" />
              <XAxis 
                dataKey="step" 
                label={{ value: t.steps, position: 'insideBottom', offset: -5, fontSize: 10, fontWeight: 'bold' }} 
                fontSize={10}
                tick={{ fill: '#141414', opacity: 0.4 }}
              />
              <YAxis 
                domain={[0, 1.1]} 
                label={{ value: t.bestValue, angle: -90, position: 'insideLeft', fontSize: 10, fontWeight: 'bold' }}
                fontSize={10}
                tick={{ fill: '#141414', opacity: 0.4 }}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontSize: '10px' }}
              />
              <Legend verticalAlign="top" height={36} iconType="circle" wrapperStyle={{ fontSize: '10px', fontWeight: 'bold', textTransform: 'uppercase' }} />
              <Line 
                type="monotone" 
                dataKey="random" 
                name={t.random} 
                stroke="#94a3b8" 
                strokeWidth={2} 
                dot={false} 
                strokeDasharray="5 5"
              />
              <Line 
                type="monotone" 
                dataKey="gpbo" 
                name={t.gpbo} 
                stroke="#3b82f6" 
                strokeWidth={2} 
                dot={false} 
              />
              <Line 
                type="monotone" 
                dataKey="amial" 
                name={t.amial} 
                stroke="#10b981" 
                strokeWidth={3} 
                dot={false}
                animationDuration={0}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Metrics Panel */}
        <div className="col-span-4 space-y-6">
          <div className="bg-[#141414] text-white p-6 rounded-[32px] shadow-xl space-y-6">
            <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-40 flex items-center gap-2">
              <Zap size={14} className="text-emerald-400" /> {t.speedupTitle}
            </h3>
            
            <div className="space-y-4">
              <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                <p className="text-[10px] uppercase font-bold opacity-40">{t.vsRandom}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-serif italic text-emerald-400">—</span>
                  <span className="text-[10px] opacity-40">{lang === 'zh' ? '未实测' : 'Not measured'}</span>
                </div>
              </div>

              <div className="p-4 bg-white/5 rounded-2xl border border-white/10">
                <p className="text-[10px] uppercase font-bold opacity-40">{t.vsGPBO}</p>
                <div className="flex items-baseline gap-2">
                  <span className="text-4xl font-serif italic text-blue-400">—</span>
                  <span className="text-[10px] opacity-40">{lang === 'zh' ? '未实测' : 'Not measured'}</span>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-2">
              <div className="flex justify-between text-[10px] font-bold uppercase">
                <span className="opacity-40">{t.discoveryRate}</span>
                <span className="text-emerald-400">{(progress / maxSteps * 100).toFixed(0)}%</span>
              </div>
              <div className="w-full bg-white/10 h-1 rounded-full overflow-hidden">
                <div className="bg-emerald-400 h-full transition-all duration-300" style={{ width: `${(progress / maxSteps) * 100}%` }} />
              </div>
            </div>
          </div>

          <div className="bg-emerald-50 p-6 rounded-[32px] border border-emerald-100 space-y-3">
            <MethodNote lang={lang}>
              {t.desc}
            </MethodNote>
          </div>
        </div>
      </div>

      {/* Discovery Comparison */}
      <div className="grid grid-cols-3 gap-6">
        {[
          { label: t.random, step: metrics.randomStep, color: 'bg-slate-100 text-slate-600' },
          { label: t.gpbo, step: metrics.gpboStep, color: 'bg-blue-100 text-blue-600' },
          { label: t.amial, step: metrics.amialStep, color: 'bg-emerald-100 text-emerald-600 border-2 border-emerald-500' }
        ].map((m, i) => (
          <div key={i} className={`p-6 rounded-3xl ${m.color} flex flex-col items-center justify-center text-center space-y-1`}>
            <p className="text-[10px] font-bold uppercase tracking-widest opacity-60">{m.label}</p>
            <p className="text-3xl font-serif italic">{m.step === maxSteps && progress < maxSteps ? '...' : m.step}</p>
            <p className="text-[9px] font-bold uppercase opacity-40">{t.targetFound}</p>
          </div>
        ))}
      </div>
    </div>
  );
};
