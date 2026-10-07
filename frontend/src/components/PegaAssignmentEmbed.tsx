import { useEffect, useRef, useState } from "react";

interface PegaEmbedElement extends HTMLElement {
  load: () => void;
}

interface Props {
  scriptSrc: string;
  pegaServerUrl: string;
  appAlias: string;
  assignmentID: string;
  casePage?: string;
  onReady?: (detail: unknown) => void;
  onAssignmentSubmit?: (detail: unknown) => void;
  onScriptError?: (message: string) => void;
}

let scriptLoadPromise: Promise<void> | null = null;

function ensurePegaScriptLoaded(src: string): Promise<void> {
  if (scriptLoadPromise) return scriptLoadPromise;
  scriptLoadPromise = new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load the Pega Web Embed script."));
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

// Thin wrapper around Pega's <pega-embed> web component, used purely to
// DISPLAY the assignment on a case the backend already created via the DX
// API (action="openAssignment") — it never creates a case itself.
export function PegaAssignmentEmbed({
  scriptSrc,
  pegaServerUrl,
  appAlias,
  assignmentID,
  casePage = "assignment",
  onReady,
  onAssignmentSubmit,
  onScriptError,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);
  const [elementReady, setElementReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    ensurePegaScriptLoaded(scriptSrc)
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const el = document.createElement("pega-embed") as PegaEmbedElement;
        el.setAttribute("action", "openAssignment");
        el.setAttribute("assignmentID", assignmentID);
        el.setAttribute("casePage", casePage);
        el.setAttribute("appAlias", appAlias);
        el.setAttribute("pegaServerUrl", pegaServerUrl);
        el.setAttribute("grantType", "none");
        el.setAttribute("deferLoad", "true");
        el.style.width = "100%";
        el.style.minHeight = "520px";
        el.style.display = "block";

        el.addEventListener("embedready", (e) => onReady?.((e as CustomEvent).detail));
        el.addEventListener("embedassignmentsubmission", (e) =>
          onAssignmentSubmit?.((e as CustomEvent).detail)
        );

        containerRef.current.innerHTML = "";
        containerRef.current.appendChild(el);
        loadedRef.current = false;
        setElementReady(true);
      })
      .catch((err: Error) => onScriptError?.(err.message));

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignmentID, pegaServerUrl, appAlias, scriptSrc]);

  useEffect(() => {
    if (!elementReady || loadedRef.current) return;
    const el = containerRef.current?.querySelector("pega-embed") as PegaEmbedElement | null;
    if (!el || typeof el.load !== "function") return;
    el.load();
    loadedRef.current = true;
  }, [elementReady]);

  return <div ref={containerRef} className="pega-embed-container" />;
}
