import { useEffect, useRef, useState } from "react";
import { loadWorkspace, saveWorkspace, type Workspace } from "./storage";

/**
 * The workspace, kept in browser storage. Saving serialises everything, so it waits for a pause
 * in editing, and saves at once if the tab is hidden or closed. The third value is true when the
 * last save failed because browser storage is full.
 */
export function useSavedWorkspace() {
  const [ws, setWs] = useState<Workspace>(loadWorkspace);
  const [storageFull, setStorageFull] = useState(false);
  const latest = useRef(ws);
  latest.current = ws;

  useEffect(() => {
    const t = setTimeout(() => setStorageFull(!saveWorkspace(ws)), 400);
    return () => clearTimeout(t);
  }, [ws]);

  useEffect(() => {
    const flush = () => setStorageFull(!saveWorkspace(latest.current));
    const onHide = () => document.visibilityState === "hidden" && flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, []);

  return [ws, setWs, storageFull] as const;
}
