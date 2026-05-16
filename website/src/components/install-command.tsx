"use client";

import { useCallback, useState } from "react";

const INSTALL_SCRIPT = `git clone https://github.com/shaneikennedy/compund.git compound
cd compound
npm install
npm run tauri build`;

export function InstallCommand() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_SCRIPT);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, []);

  return (
    <div className="mt-8 w-full max-w-xl rounded-xl border border-zinc-800 bg-zinc-950/80 shadow-lg shadow-black/20">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-2.5">
        <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">
          Install from source
        </span>
        <button
          type="button"
          onClick={copy}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 font-mono text-xs text-zinc-200 transition-colors hover:border-zinc-600 hover:bg-zinc-800 hover:text-zinc-50"
          aria-label={copied ? "Copied" : "Copy command to clipboard"}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 font-mono text-[13px] leading-relaxed text-zinc-300">
        <code>{INSTALL_SCRIPT}</code>
      </pre>
      <p className="border-t border-zinc-800/90 px-4 py-3 text-xs leading-relaxed text-zinc-500">
        Requires{" "}
        <a
          href="https://nodejs.org/"
          className="text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-300"
        >
          Node.js
        </a>
        ,{" "}
        <a
          href="https://rustup.rs/"
          className="text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-300"
        >
          Rust
        </a>
        , and{" "}
        <a
          href="https://v2.tauri.app/start/prerequisites/"
          className="text-zinc-400 underline decoration-zinc-600 underline-offset-2 hover:text-zinc-300"
        >
          Tauri prerequisites
        </a>
        . Installers land under{" "}
        <span className="font-mono text-zinc-400">
          src-tauri/target/release/bundle/
        </span>
        .
      </p>
    </div>
  );
}
