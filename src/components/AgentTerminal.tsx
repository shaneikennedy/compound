import "@xterm/xterm/css/xterm.css";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";

type TerminalDataPayload = { data: number[] };

export function AgentTerminal({
  rootPath,
  lightChrome,
}: {
  rootPath: string;
  lightChrome: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

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
    term.loadAddon(fit);
    term.open(el);
    fit.fit();

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
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        term.writeln(`\r\n\x1b[31mCould not start shell: ${msg}\x1b[0m\r\n`);
      }

      if (dead) {
        void invoke("terminal_kill").catch(() => {});
      }
    })();

    return () => {
      dead = true;
      ro.disconnect();
      disposeResize.dispose();
      disposeData.dispose();
      for (const u of unlisten) u();
      void invoke("terminal_kill").catch(() => {});
      term.dispose();
    };
  }, [rootPath, lightChrome]);

  return (
    <div
      ref={hostRef}
      className="agent-terminal-host"
      data-codar-agent-terminal=""
      data-focus-landmark=""
      data-focus-map-label="Agent terminal"
      tabIndex={-1}
    />
  );
}
