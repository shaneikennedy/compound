import "@xterm/xterm/css/xterm.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

type TerminalDataPayload = { data: number[] };

function focusTerminalAfterShellUiSettles(
  isAlive: () => boolean,
  term: Terminal,
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      window.setTimeout(() => {
        if (!isAlive()) return;
        try {
          term.focus();
        } catch {
          /* xterm readiness / layout */
        }
      }, 0);
    });
  });
}

export function AgentTerminal({
  rootPath,
  lightChrome,
  visible,
}: {
  rootPath: string;
  lightChrome: boolean;
  visible: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;

    let dead = false;
    const unlisten: Array<() => void> = [];

    const term = new Terminal({
      cursorBlink: true,
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      theme: lightChrome
        ? {
            background: "#fafafa",
            foreground: "#09090b",
            cursor: "#09090b",
          }
        : {
            background: "#09090b",
            foreground: "#fafafa",
            cursor: "#fafafa",
          },
    });

    const fit = new FitAddon();
    fitRef.current = fit;
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fit.fit();

    /** xterm/WKWebView can report odd `target` paths; still stop Space from reaching `window` for the focus-map chord. */
    const stopSpaceBubbleToWindow = (e: KeyboardEvent) => {
      if (e.key !== " ") return;
      const active = document.activeElement;
      if (!active || !el.contains(active)) return;
      e.stopPropagation();
    };
    el.addEventListener("keydown", stopSpaceBubbleToWindow);

    const ro = new ResizeObserver(() => {
      fit.fit();
    });
    ro.observe(el);

    const disposeResize = term.onResize(({ cols, rows }) => {
      void invoke("terminal_resize", { cols, rows }).catch(() => {});
    });

    const disposeData = term.onData((data) => {
      void invoke("terminal_write", {
        data: Array.from(new TextEncoder().encode(data)),
      }).catch(() => {});
    });

    void (async () => {
      const uData = await listen<TerminalDataPayload>("terminal:data", (e) => {
        term.write(new Uint8Array(e.payload.data));
      });
      if (dead) {
        uData();
        return;
      }
      unlisten.push(uData);

      const uExit = await listen("terminal:exit", () => {
        term.writeln("\r\n\x1b[90m[shell exited]\x1b[0m");
      });
      if (dead) {
        uExit();
        return;
      }
      unlisten.push(uExit);

      try {
        await invoke("terminal_spawn", {
          cwd: rootPath,
          cols: term.cols,
          rows: term.rows,
        });
        focusTerminalAfterShellUiSettles(
          () => !dead && visibleRef.current,
          term,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        term.writeln(`\r\n\x1b[31mCould not start shell: ${msg}\x1b[0m\r\n`);
        focusTerminalAfterShellUiSettles(
          () => !dead && visibleRef.current,
          term,
        );
      }

      if (dead) {
        void invoke("terminal_kill").catch(() => {});
      }
    })();

    return () => {
      dead = true;
      el.removeEventListener("keydown", stopSpaceBubbleToWindow);
      termRef.current = null;
      fitRef.current = null;
      ro.disconnect();
      disposeResize.dispose();
      disposeData.dispose();
      for (const u of unlisten) u();
      void invoke("terminal_kill").catch(() => {});
      term.dispose();
    };
  }, [rootPath, lightChrome]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let focusTimer: ReturnType<typeof window.setTimeout> | undefined;
    let raf1 = 0;
    let raf2 = 0;

    raf1 = window.requestAnimationFrame(() => {
      if (cancelled) return;
      raf2 = window.requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          fitRef.current?.fit();
        } catch {
          /* xterm layout not ready */
        }
        focusTimer = window.setTimeout(() => {
          if (cancelled || !visibleRef.current) return;
          try {
            termRef.current?.focus();
          } catch {
            /* xterm readiness */
          }
        }, 0);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
      if (focusTimer !== undefined) window.clearTimeout(focusTimer);
    };
  }, [visible]);

  return (
    <div
      ref={hostRef}
      className="agent-terminal-host"
      data-compound-agent-terminal=""
      tabIndex={-1}
    />
  );
}
