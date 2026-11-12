import { DEFAULT_HUB_QUERY, type HubQuery } from "../dataHub";

export const RESEARCH_SCENES = [
  { id: "solid-electrolyte", zh: "固态电解质", en: "Solid electrolytes", available: true,
    descriptionZh: "含 Li、O 的材料 · 带隙与热力学稳定性联合初筛", descriptionEn: "Li/O materials · band gap and thermodynamic stability screening",
    query: { ...DEFAULT_HUB_QUERY, elements: "Li,O", objective: "band-gap" } as HubQuery },
  { id: "pcec-sofc", zh: "PCEC / SOFC", en: "PCEC / SOFC", available: false,
    descriptionZh: "即将开放 · 电极与氧空位目标，合作数据接入后验证", descriptionEn: "Coming next · electrodes and oxygen vacancies, validated with partner data", query: null },
  { id: "catalysis", zh: "催化材料", en: "Catalysis", available: false,
    descriptionZh: "即将开放 · 反应条件与活性目标，支持专家模式导入", descriptionEn: "Coming next · reaction-specific activity, custom imports in expert mode", query: null },
] as const;
export const DEFAULT_SCENE_QUERY: HubQuery = { ...RESEARCH_SCENES[0].query };
export function sceneForQuery(query: HubQuery) {
  return query.source === "mp-snapshot" && query.objective === "band-gap" && query.elements.replace(/\s/g, "") === "Li,O" && query.match === "contains"
    ? "solid-electrolyte" : "custom";
}
