import { hashString } from "../SeededRandom";
import type { PartitionAssignments, PartitionName } from "./types";

/** Balanced first split; subsequent groups get independent buckets without moving old groups. */
export function splitCompositionGroups(samples: { group: string }[], seed: number, frozen: PartitionAssignments = {}, discoveryOnly: readonly string[] = []) {
  const groups = [...new Set(samples.map(row => row.group))].sort((a, b) =>
    hashString(String(seed) + a) - hashString(String(seed) + b) || a.localeCompare(b));
  if (groups.length < 8) throw new Error("至少需要 8 个独立组成，当前为 " + groups.length);
  const split: Record<PartitionName, string[]> = { discovery: [], tuning: [], test: [] };
  const initial = Object.keys(frozen).length === 0;
  const testCount = Math.max(2, Math.floor(groups.length * 0.2)), tuneCount = Math.max(2, Math.floor(groups.length * 0.2));
  const forced = new Set(discoveryOnly); let freeIndex = 0;
  groups.forEach(group => {
    const bucket = hashString("partition:" + seed + ":" + group) % 10;
    const i = forced.has(group) ? -1 : freeIndex++;
    const destination = forced.has(group) ? "discovery" : initial ? i < testCount ? "test" : i < testCount + tuneCount ? "tuning" : "discovery"
      : Object.hasOwn(frozen, group) ? frozen[group] : bucket < 2 ? "test" : bucket < 4 ? "tuning" : "discovery";
    if (!Object.hasOwn(split, destination)) throw new Error("无效的组成分区");
    split[destination].push(group);
  });
  if (split.discovery.length < 4 || split.tuning.length < 2 || split.test.length < 2) throw new Error("固定分区的有效组成不足：需发现4组、选择2组、测试2组");
  return split;
}
export function freezePartitions(split: Record<PartitionName, string[]>): PartitionAssignments {
  return Object.fromEntries(Object.entries(split).flatMap(([partition, groups]) => groups.map(group => [group, partition]))) as PartitionAssignments;
}
