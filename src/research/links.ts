import type { ResearchModules } from "./types";
export function configurationEvidence(modules: ResearchModules, runId: string, candidateId: string) {
  const artifact = modules.structures.find(a => a.stage === "relaxed" && a.runId === runId && a.candidateId === candidateId);
  const xrd = modules.experiments.find(r => {
    const ref = r.reference.binding;
    return ref?.kind === "derived" && ref.derived?.runId === runId && ref.derived.candidateId === candidateId
      && (!artifact || ref.structureHash === artifact.structureHash);
  });
  return { artifact, xrd, geometry: artifact ? modules.geometry.filter(g => g.structureHash === artifact.structureHash && g.recordKey === artifact.recordKey) : [] };
}
