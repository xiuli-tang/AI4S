export const networkMessages = {
  MISSING_API_KEY: ["实时材料服务暂未开通，可选择离线 MP 数据。", "Live materials access is not enabled. Choose the offline MP collection."],
  AUTHENTICATION_FAILED: ["实时材料服务连接异常，可选择离线 MP 数据或联系网站管理员。", "Live materials access is unavailable. Use offline MP or contact the site administrator."],
  ACCESS_DENIED: ["实时材料服务暂不可用，可继续使用离线 MP 数据。", "Live materials access is unavailable; offline MP remains available."],
  RATE_LIMITED: ["材料服务请求过于频繁，请稍后再同步。", "The materials service is rate limited. Try syncing later."],
  TIMEOUT: ["材料请求超时，请检查网络后重试。", "The materials request timed out. Check the network and retry."],
  PROXY_ERROR: ["实时材料服务连接中断，请稍后重试或使用离线数据。", "Live materials access was interrupted. Retry later or use offline data."],
  DNS_ERROR: ["暂时无法连接实时材料服务，请稍后重试或使用离线数据。", "Live materials access cannot be reached. Retry later or use offline data."],
  TLS_ERROR: ["实时材料服务的安全连接异常，请联系网站管理员。", "The live materials secure connection is unavailable. Contact the site administrator."],
  REDIRECT_ERROR: ["材料请求遇到异常重定向，请检查网络转发。", "The materials request encountered an unexpected redirect."],
  UPSTREAM_ERROR: ["材料服务暂时不可用，请稍后重试。", "The materials service is temporarily unavailable. Retry later."],
  BAD_RESPONSE: ["材料服务返回的数据格式不符合要求。", "The materials service returned an unexpected data format."],
  NETWORK_ERROR: ["无法连接材料服务，请检查网络后重试。", "Cannot connect to the materials service. Check the network and retry."],
} as const;

export type NetworkIssueCode = keyof typeof networkMessages;

export function networkIssueCode(value: unknown): NetworkIssueCode {
  return typeof value === "string" && Object.hasOwn(networkMessages, value)
    ? value as NetworkIssueCode : "NETWORK_ERROR";
}

export function networkMessage(code: NetworkIssueCode, language: "zh" | "en") {
  return networkMessages[code][language === "zh" ? 0 : 1];
}
