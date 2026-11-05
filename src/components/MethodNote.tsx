import type { ReactNode } from "react";
import { useI18n } from "../i18n";

/** Compact, keyboard-accessible disclosure shared by the research workspaces. */
export default function MethodNote({ children, lang, title }: {
  children: ReactNode; lang?: "zh" | "en"; title?: string;
}) {
  const context = useI18n(); lang ??= context.lang;
  return <details className="method-note">
    <summary>{title ?? (lang === "zh" ? "ℹ 方法论说明" : "ℹ Method notes")}</summary>
    <div className="method-note-content">{children}</div>
  </details>;
}
