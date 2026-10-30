import React, { Component, lazy, Suspense } from "react";
import type { MaterialStructureRequest } from "../structures/materialStructure";
import type { CrystalStructure } from "../structures/types";
import type { Restore } from "../research/types";

const StructureWorkspace = lazy(() => import("./StructureWorkspace"));
interface Props { open: boolean; onClose(): void; lang: "zh" | "en"; materialRequest?: MaterialStructureRequest | null; onImportMode?(): void; onOpenLab?(structure: CrystalStructure): void;
  restored?: Restore<CrystalStructure>; onStructure?(structure: CrystalStructure): void; onUseStructure?(structure: CrystalStructure, action: "queue" | "geometry"): void; }

class StructureBoundary extends Component<Props & { children: React.ReactNode }, { failed: boolean }> {
  declare props: Props & { children: React.ReactNode };
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    if (!this.props.open) return null;
    return <div role="alert" className="fixed bottom-4 right-4 z-50 bg-white border p-4 rounded shadow">
      <p>{this.props.lang === "zh" ? "结构查看器加载失败，请刷新页面后重试。" : "The structure viewer failed to load. Refresh the page to retry."}</p>
      <button type="button" onClick={this.props.onClose}>{this.props.lang === "zh" ? "关闭" : "Close"}</button>
    </div>;
  }
}

/** Mounted only after the first request; retained thereafter to preserve imports. */
export default function StructurePanel(props: Props) {
  return <StructureBoundary {...props}>
    <Suspense fallback={props.open ? <p role="status" className="fixed bottom-4 right-4 z-50 bg-white p-3 rounded shadow">{props.lang === "zh" ? "正在加载结构查看器…" : "Loading structure viewer…"}</p> : null}>
      <StructureWorkspace {...props} />
    </Suspense>
  </StructureBoundary>;
}
