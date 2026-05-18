import "@xterm/xterm/css/xterm.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

type TerminalDataPayload = { sessionId: string; data: number[] };

type TerminalExitPayload = { sessionId: string };

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

function shellInputNewline(): string {
  /** PowerShell favors CRLF for delivered input; POSIX shells accept `\n`. */
  if (
    typeof navigator !== "undefined" &&
    navigator.userAgent.includes("Windows")
  )
    return "\r\n";
  return "\n";
}

export function AgentTerminal({
  sessionId,
  rootPath,
  lightChrome,
  visible,
  startupShellLine,
  onStartupShellLineConsumed,
}: {
  /** Stable workspace tab id — maps to one native PTY session. */
  sessionId: string;
  rootPath: string;
  lightChrome: boolean;
  visible: boolean;
  /** Latest line forwarded to the shell once per PTY (read from a ref at spawn time — changes do not recreate the PTY). */
  startupShellLine?: string | null;
  /** Called once after injected input is typed into a new PTY (worktree bootstrap, default agent CLI, etc.). */
  onStartupShellLineConsumed?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  /** Avoid stale closure without making `startupShellLine` recreate the PTY on every keystroke upstream. */
  const startupShellLineRef = useRef(startupShellLine);
  startupShellLineRef.current = startupShellLine;
  const onConsumedRef = useRef(onStartupShellLineConsumed);
  onConsumedRef.current = onStartupShellLineConsumed;

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
      void invoke("terminal_resize", { sessionId, cols, rows }).catch(() => {});
    });

    const disposeData = term.onData((data) => {
      void invoke("terminal_write", {
        sessionId,
        data: Array.from(new TextEncoder().encode(data)),
      }).catch(() => {});
    });

    void (async () => {
      const uData = await listen<TerminalDataPayload>("terminal:data", (e) => {
        if (e.payload.sessionId !== sessionId) return;
        term.write(new Uint8Array(e.payload.data));
      });
      if (dead) {
        uData();
        return;
      }
      unlisten.push(uData);

      const uExit = await listen<TerminalExitPayload>(
        "terminal:exit",
        (e) => {
          if (e.payload.sessionId !== sessionId) return;
          term.writeln("\r\n\x1b[90m[shell exited]\x1b[0m");
        },
      );
      if (dead) {
        uExit();
        return;
      }
      unlisten.push(uExit);

      try {
        await invoke("terminal_spawn", {
          sessionId,
          cwd: rootPath,
          cols: term.cols,
          rows: term.rows,
        });
        focusTerminalAfterShellUiSettles(
          () => !dead && visibleRef.current,
          term,
        );

        const line = startupShellLineRef.current?.trim();
        if (line) {
          await new Promise<void>((resolve) =>
            window.setTimeout(resolve, 80),
          );
          if (!dead) {
            const payload = new TextEncoder().encode(
              `${line}${shellInputNewline()}`,
            );
            await invoke("terminal_write", {
              sessionId,
              data: Array.from(payload),
            }).catch(() => {});
            onConsumedRef.current?.();
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        term.writeln(`\r\n\x1b[31mCould not start shell: ${msg}\x1b[0m\r\n`);
        focusTerminalAfterShellUiSettles(
          () => !dead && visibleRef.current,
          term,
        );
      }

      if (dead) {
        void invoke("terminal_kill", { sessionId }).catch(() => {});
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
      void invoke("terminal_kill", { sessionId }).catch(() => {});
      term.dispose();
    };
  }, [sessionId, rootPath, lightChrome]);

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
