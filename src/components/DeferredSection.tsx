import { useEffect, useRef, useState, type ReactNode } from "react";

/** Keep research state after first exposure; load below-the-fold modules only near the viewport. */
export default function DeferredSection({ children, label, force = false }: { children: ReactNode; label: string; force?: boolean }) {
  const element = useRef<HTMLDivElement>(null), [seen, setSeen] = useState(force);
  useEffect(() => {
    if (force) setSeen(true);
    if (seen || force) return;
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) { setSeen(true); observer.disconnect(); } }, { rootMargin: "150px" });
    if (element.current) observer.observe(element.current); return () => observer.disconnect();
  }, [seen, force]);
  return <div ref={element} className="deferred-section">{seen || force ? children : <p className="module-placeholder">{label}</p>}</div>;
}
