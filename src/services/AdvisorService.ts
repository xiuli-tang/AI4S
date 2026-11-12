import type { AdvisorWireMessage, AdvisorLanguage } from "./AdvisorContext";

const errors = {
  MISSING_API_KEY: ["AI 顾问暂未开通，请联系网站管理员。材料筛选与分析仍可使用。", "The AI advisor is not enabled yet. Contact the site administrator; material screening and analysis remain available."],
  AUTHENTICATION_FAILED: ["AI 顾问连接暂时异常，请稍后重试或联系网站管理员。", "The AI advisor connection is unavailable. Retry later or contact the site administrator."],
  ACCESS_DENIED: ["AI 顾问暂时无法提供服务，请稍后重试或联系网站管理员。", "The AI advisor is temporarily unavailable. Retry later or contact the site administrator."],
  RATE_LIMITED: ["模型服务限流，请稍后再发送。", "Rate limited. Send again later."],
  TIMEOUT: ["分析超时，未自动重复请求。可以缩短问题后手动重试。", "Analysis timed out without an automatic retry. Try a shorter question."],
  PROXY_ERROR: ["AI 顾问连接中断，请稍后重试。", "The AI advisor connection was interrupted. Retry later."],
  DNS_ERROR: ["暂时无法连接 AI 顾问，请稍后重试。", "The AI advisor cannot be reached right now. Retry later."],
  TLS_ERROR: ["AI 顾问的安全连接未能建立，请联系网站管理员。", "A secure advisor connection could not be established. Contact the site administrator."],
  BAD_RESPONSE: ["模型没有返回有效文字，请稍后手动重试。", "The model did not return usable text. Retry manually."],
  NETWORK_ERROR: ["连接模型服务失败，请检查网络后手动重试。", "Cannot reach the model service. Check the network and retry manually."],
  UPSTREAM_ERROR: ["模型服务暂时不可用，请稍后再试。", "The model service is temporarily unavailable."],
  REDIRECT_ERROR: ["模型请求遇到异常重定向，请检查服务地址和网络。", "Unexpected model redirect. Check the endpoint and network."],
  INVALID_REQUEST: ["对话请求无效或过长，请清空会话后重试。", "Invalid or oversized request. Clear the conversation and retry."],
} as const;

export class AdvisorError extends Error {
  constructor(public code: keyof typeof errors) { super(code); this.name = "AdvisorError"; }
}

export function advisorErrorMessage(error: unknown, lang: AdvisorLanguage) {
  const code = error instanceof AdvisorError ? error.code : "NETWORK_ERROR";
  return errors[code][lang === "zh" ? 0 : 1];
}

export async function requestAdvisor(messages: AdvisorWireMessage[], signal: AbortSignal) {
  const deadline = AbortSignal.timeout(50_000);
  try {
    const response = await fetch("/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      signal: AbortSignal.any([signal, deadline]),
      body: JSON.stringify({ messages, temperature: 0.3, max_tokens: 2048 }),
    });
    let data: any;
    try { data = await response.json(); } catch { throw new AdvisorError("BAD_RESPONSE"); }
    if (!response.ok) throw new AdvisorError(typeof data?.code === "string" && Object.hasOwn(errors, data.code) ? data.code : response.status === 413 ? "INVALID_REQUEST" : "UPSTREAM_ERROR");
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string" || !answer.trim()) throw new AdvisorError("BAD_RESPONSE");
    return {
      answer: answer.trim(), model: typeof data.model === "string" ? data.model.slice(0, 100) : "deepseek-flash",
      truncated: data.choices[0].finish_reason === "length",
      tokens: Number.isFinite(data.usage?.total_tokens) ? data.usage.total_tokens as number : undefined,
    };
  } catch (error) {
    if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
    if (deadline.aborted) throw new AdvisorError("TIMEOUT");
    if (error instanceof AdvisorError) throw error;
    throw new AdvisorError("NETWORK_ERROR");
  }
}
