import type { ReactNode } from "react";

/** Compact, keyboard-accessible disclosure shared by the research workspaces. */
export default function MethodNote({ children, lang = "zh", title }: {
  children: ReactNode; lang?: "zh" | "en"; title?: string;
}) {
  return <details className="method-note">
    <summary>{title ?? (lang === "zh" ? "ℹ 方法论说明" : "ℹ Method notes")}</summary>
    <div className="method-note-content">{children}</div>
  </details>;
}
