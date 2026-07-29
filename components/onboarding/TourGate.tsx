import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import { startPageTour, getSeenTours, pathToTourPage, type TourPage } from "@/lib/tour";

// Mounted once in Layout. Auto-starts the tour for the current page the first time
// the user lands on it (tracked server-side via /api/tour), one page at a time.
export default function TourGate() {
  const router = useRouter();
  const [seen, setSeen] = useState<Set<TourPage> | null>(null);
  const startedRef = useRef<Set<TourPage>>(new Set());

  useEffect(() => {
    getSeenTours().then(setSeen);
  }, []);

  useEffect(() => {
    if (!seen) return;
    const page = pathToTourPage(router.pathname);
    if (!page || seen.has(page) || startedRef.current.has(page)) return;
    // Let the page finish its own data fetch / render before spotlighting elements.
    // Guarded at fire-time (not schedule-time) so React StrictMode's dev double-effect
    // (which would otherwise clear this timeout via the first run's cleanup) can't
    // silently swallow the only scheduled start.
    const t = setTimeout(() => {
      if (startedRef.current.has(page)) return;
      startedRef.current.add(page);
      startPageTour(page);
    }, 600);
    return () => clearTimeout(t);
  }, [seen, router.pathname]);

  return null;
}
