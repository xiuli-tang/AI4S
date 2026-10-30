import type { Material, ALState } from "../types";
import type { DistillationResult } from "../engine/distillation/types";
import type { ParetoCandidate, ParetoState, ObjectiveScales, Weights } from "../engine/pareto/ParetoEngine";
import type { ConfigurationRecord, UmlipModel } from "../umlip/types";
import type { CrystalStructure } from "../structures/types";
import type { XrdResult, ComparisonResult, XrdPoint } from "../synthesis/types";

export interface PresentationPreset {
  schema: "ai4s-presentation-1";
  id: string;
  createdAt: string;
  provenance: { baseCommit: string; mpRetrievedAt: string; recordCount: number; seed: number; initialSamplingSeed: number; description: string };
  learning: { pool: Material[]; state: ALState; strategy: "UCB"; batchSize: number; budget: number; formula: DistillationResult };
  pareto: { pool: ParetoCandidate[]; state: ParetoState; scales: ObjectiveScales; budget: number; weights: Weights; seed: number };
  umlip: {
    sourceRunId: string; sourceRounds: number; sourceConverged: number; model: UmlipModel;
    reference: { id: string; energyEv: number; energyPerAtomEv: number }; fmax: number;
    candidates: (ConfigurationRecord & { trajectory: string; poscar: string; crystal: CrystalStructure })[];
  };
  xrd: { structure: CrystalStructure; result: XrdResult; comparison: ComparisonResult; points: XrdPoint[]; demo: true; filename: string };
  advisor: { title: string; answer: string; source: string; generatedAt: string };
}
