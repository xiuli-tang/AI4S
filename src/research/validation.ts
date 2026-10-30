import axios from "axios";
import type { Material } from "../types";
import type { ReferenceBinding, SynthesisFeedback } from "../synthesis/types";
import { materialRecordKey } from "../materialContext";
import { sameReferenceBinding } from "../synthesis/binding";
import { applySynthesisFeedback, feasibilityPrior } from "../synthesis/feedback";

export function rebindValidation(material: Material, binding?: ReferenceBinding, feedback = material.synthesisFeedback): Material {
  const prior = feasibilityPrior(material.synthesisFeedback, material), value = material.acquisitionValue;
  const base = value === undefined ? undefined : value >= 0 ? value / prior : value * prior;
  const current = { ...material, validationStructure: binding, synthesisFeedback: undefined, acquisitionValue: base };
  return feedback ? applySynthesisFeedback([current], feedback)[0] : current;
}

/** Reconnect derived evidence to the local converged run before using its prior. */
export async function restoreValidatedFeedback(pool: Material[], registry: Record<string, SynthesisFeedback>, signal?: AbortSignal,
  load = async (r: ReferenceBinding) => (await axios.get<{ binding: ReferenceBinding }>(
    `/api/umlip/runs/${encodeURIComponent(r.derived!.runId)}/candidates/${encodeURIComponent(r.derived!.candidateId)}/reference`, { signal })).data.binding) {
  let unavailable = 0;
  const materials = await Promise.all(pool.map(async material => {
    const key = materialRecordKey(material), feedback = registry[key] ?? material.synthesisFeedback;
    const expected = material.validationStructure ?? (feedback?.reference?.kind === "derived" ? feedback.reference : undefined);
    let current = rebindValidation(material, undefined, undefined);
    if (expected?.kind === "derived" && expected.derived) {
      try {
        const verified = await load(expected); signal?.throwIfAborted();
        if (!sameReferenceBinding(verified, expected) || verified.recordKey !== key || verified.derived?.parentStructureHash !== material.structureHash) throw new Error("派生构型来源已变化。");
        current = rebindValidation(current, verified, undefined);
      } catch (e) { signal?.throwIfAborted(); unavailable++; }
    }
    return feedback ? applySynthesisFeedback([current], feedback)[0] : current;
  }));
  return { pool: materials, unavailable };
}
