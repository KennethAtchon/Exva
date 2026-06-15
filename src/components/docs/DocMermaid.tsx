import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/useTheme";

let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((module) => module.default);
  }
  return mermaidPromise;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
}

function getMermaidConfig() {
  const surface = cssVar("--surface");
  const surface2 = cssVar("--surface2");
  const surface3 = cssVar("--surface3");
  const text1 = cssVar("--text1");
  const text2 = cssVar("--text2");
  const border = cssVar("--border");

  return {
    theme: "base" as const,
    themeVariables: {
      primaryColor: surface2,
      primaryTextColor: text1,
      primaryBorderColor: border,
      lineColor: text2,
      secondaryColor: surface3,
      tertiaryColor: surface,
      background: surface,
      mainBkg: surface2,
      actorBkg: surface2,
      actorBorder: border,
      actorTextColor: text1,
      signalColor: text2,
      signalTextColor: text1,
      labelBoxBkgColor: surface2,
      labelBoxBorderColor: border,
      labelTextColor: text1,
      loopTextColor: text1,
      noteBkgColor: surface3,
      noteTextColor: text1,
      noteBorderColor: border,
    },
  };
}

function removeMermaidArtifacts(renderId: string) {
  document.getElementById(renderId)?.remove();
  document.getElementById(`d${renderId}`)?.remove();
}

const fullscreenShellClass = cn(
  "[&:fullscreen]:fixed [&:fullscreen]:inset-0 [&:fullscreen]:z-[9999]",
  "[&:fullscreen]:mb-0 [&:fullscreen]:flex [&:fullscreen]:h-screen [&:fullscreen]:w-screen",
  "[&:fullscreen]:max-h-none [&:fullscreen]:flex-col [&:fullscreen]:overflow-hidden",
  "[&:fullscreen]:rounded-none [&:fullscreen]:border-0 [&:fullscreen]:bg-[var(--bg)]",
  "[&:-webkit-full-screen]:fixed [&:-webkit-full-screen]:inset-0 [&:-webkit-full-screen]:z-[9999]",
  "[&:-webkit-full-screen]:mb-0 [&:-webkit-full-screen]:flex [&:-webkit-full-screen]:h-screen [&:-webkit-full-screen]:w-screen",
  "[&:-webkit-full-screen]:max-h-none [&:-webkit-full-screen]:flex-col [&:-webkit-full-screen]:overflow-hidden",
  "[&:-webkit-full-screen]:rounded-none [&:-webkit-full-screen]:border-0 [&:-webkit-full-screen]:bg-[var(--bg)]",
);

export function DocMermaid({ chart }: { chart: string }) {
  const reactId = useId().replace(/:/g, "");
  const shellRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const exitFullscreen = useCallback(async () => {
    if (document.fullscreenElement === shellRef.current) {
      await document.exitFullscreen();
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell) return;

    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
      } else {
        await shell.requestFullscreen();
      }
    } catch {
      // Browser blocked fullscreen; nothing else to do.
    }
  }, []);

  useEffect(() => {
    const syncFullscreen = () => {
      setIsFullscreen(document.fullscreenElement === shellRef.current);
    };
    document.addEventListener("fullscreenchange", syncFullscreen);
    return () =>
      document.removeEventListener("fullscreenchange", syncFullscreen);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const renderId = `doc-mermaid-${reactId}`;

    async function render() {
      setError(null);
      setReady(false);
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      await exitFullscreen();

      const task = mermaidRenderQueue.then(async () => {
        const mermaid = await loadMermaid();
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          ...getMermaidConfig(),
        });
        const { svg } = await mermaid.render(renderId, chart.trim());
        removeMermaidArtifacts(renderId);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setReady(true);
        }
      });

      mermaidRenderQueue = task.catch(() => undefined);

      try {
        await task;
      } catch {
        removeMermaidArtifacts(renderId);
        if (!cancelled) {
          setError("Diagram could not be rendered.");
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
      removeMermaidArtifacts(renderId);
      void exitFullscreen();
    };
  }, [chart, theme, reactId, exitFullscreen]);

  if (error) {
    return (
      <div className="mb-6 rounded-lg border border-[var(--border)] bg-[var(--surface2)] px-4 py-3 text-[13px] text-[var(--text3)]">
        {error}
      </div>
    );
  }

  return (
    <div
      ref={shellRef}
      className={cn(
        "relative mb-6 overflow-x-auto rounded-lg border border-[var(--border)] bg-[var(--surface2)] p-4",
        fullscreenShellClass,
        isFullscreen && "overflow-hidden p-0",
      )}
      aria-busy={!ready}
    >
      {isFullscreen ? (
        <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-4 py-3">
          <div className="text-[13px] font-medium text-[var(--text2)]">
            Diagram
          </div>
          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text2)] transition-colors hover:bg-[var(--surface2)] hover:text-[var(--text1)]"
            aria-label="Exit full screen"
          >
            <Minimize2 size={16} />
          </button>
        </div>
      ) : null}

      {ready && !isFullscreen ? (
        <button
          type="button"
          onClick={() => void toggleFullscreen()}
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border)] bg-[var(--surface)] text-[var(--text2)] transition-colors hover:border-[var(--accent)] hover:text-[var(--text1)]"
          aria-label="Enter full screen"
        >
          <Maximize2 size={14} />
        </button>
      ) : null}

      {!ready ? (
        <div className="py-8 text-center text-[12px] text-[var(--text3)]">
          Loading diagram…
        </div>
      ) : null}

      <div
        className={cn(
          isFullscreen && "min-h-0 flex-1 overflow-auto p-6",
          !ready && "hidden",
        )}
      >
        <div
          ref={containerRef}
          className={cn(
            "[&_svg]:mx-auto [&_svg]:max-w-full",
            isFullscreen &&
              "flex min-h-full items-center justify-center [&_svg]:h-auto [&_svg]:max-w-none",
          )}
        />
      </div>
    </div>
  );
}
