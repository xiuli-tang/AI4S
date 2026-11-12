import { useMemo } from "react";
import type { ResearchSession } from "../research/types";
import { sessionReport } from "../research/report";
import ResearchReport from "./ResearchReport";
export default function ResearchPresentation({ session, onExit }: { session: ResearchSession; onExit(): void }) {
  const report = useMemo(() => sessionReport(session), [session]);
  return <ResearchReport key={report.id} report={report} onExit={onExit} />;
}
