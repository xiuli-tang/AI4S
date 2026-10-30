import type { Lattice, Vec3 } from "../structures/types";

export interface AtomicConfiguration {
  cell: Lattice;
  elements: string[];
  fractional: Vec3[];
  /** VASP Direct-basis motion flags, not Cartesian masks. */
  movable: [boolean, boolean, boolean][];
  pbc: [true, true, true];
}
export interface ConfigurationInput {
  id: string;
  name: string;
  source: string;
  structure: AtomicConfiguration;
  origin?: { recordKey: string; structureHash: string; materialId?: string };
}
export interface UmlipSettings {
  budget: number;
  initialSamples: number;
  batchSize: number;
  fmax: number;
  maxSteps: number;
  seed: number;
}
export interface RelaxationProgress {
  step: number;
  energyEv: number;
  maxForceEvAngstrom: number;
  elapsedSeconds: number;
  fractional: Vec3[];
}
export interface RelaxationResult {
  converged: boolean;
  energyEv: number;
  energyPerAtomEv: number;
  maxForceEvAngstrom: number;
  rawMaxForceEvAngstrom: number;
  steps: number;
  elapsedSeconds: number;
  startedAt: string;
  finishedAt: string;
  structure: AtomicConfiguration;
}
export interface UmlipModel {
  label: string;
  filename: string;
  sha256: string;
  runnerSha256: string;
  device: "cpu";
  dtype: "float64";
  threads: number;
  atomicNumbers: number[];
  versions: Record<string, string>;
}
export type ConfigurationStatus = "pending" | "running" | "converged" | "unconverged" | "failed" | "cancelled";
export interface ConfigurationRecord extends ConfigurationInput {
  inputSha256: string;
  features: number[];
  status: ConfigurationStatus;
  round?: number;
  selectionReason?: string;
  progress?: RelaxationProgress;
  result?: RelaxationResult;
  relativeEnergyEv?: number;
  relativeEnergyPerAtomEv?: number;
  prediction?: { meanRelativeEvPerAtom: number; sigmaEvPerAtom: number; lcbEvPerAtom: number };
  error?: string;
}
export interface UmlipRun {
  id: string;
  status: "running" | "completed" | "cancelled" | "failed";
  createdAt: string;
  finishedAt?: string;
  wallSeconds: number;
  modelLoadSeconds?: number;
  surrogateSeconds: number;
  atomCount: number;
  composition: Record<string, number>;
  settings: UmlipSettings;
  descriptorVersion: "periodic-pair-rbf-v1";
  model?: UmlipModel;
  reference?: { id: string; energyEv: number; energyPerAtomEv: number };
  bestRelativeEvPerAtom?: number;
  rounds: { round: number; evaluated: number; converged: number; bestRelativeEvPerAtom: number | null }[];
  candidates: ConfigurationRecord[];
  error?: string;
}
export interface UmlipCapabilities {
  configured: boolean;
  message: string;
  modelLabel: string;
  limits: { atoms: number; candidates: number; steps: number };
}
