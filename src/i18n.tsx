import { createContext, useContext } from "react";
export type Language = "zh" | "en";
export const LanguageContext = createContext<Language>("zh");
export function useI18n() {
  const lang = useContext(LanguageContext);
  return { lang, t: (zh: string, en: string) => lang === "zh" ? zh : en };
}
export function userError(error: unknown, lang: Language) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/DEEPSEEK|MP_API_KEY|\.env|API.key|credential/i.test(message)) return lang === "zh"
    ? "该服务暂未就绪，请稍后重试或联系网站管理员。" : "This service is not ready. Please retry later or contact the site administrator.";
  if (!message || lang === "en" && /[\u3400-\u9fff]/.test(message)) return lang === "zh"
    ? "操作未完成，请检查输入后重试。" : "The operation could not be completed. Check your input and retry.";
  return message;
}
