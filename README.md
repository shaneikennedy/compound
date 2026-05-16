# Compound

Desktop workspace app for **local Git repositories**: browse files with syntax highlighting, review **uncommitted changes** against `HEAD`, and work with an **agent** session (terminal + optional worktrees). Built with [Tauri 2](https://tauri.app/), React, and Vite.

**Website:** [compoundapp.vercel.app](https://compoundapp.vercel.app/)

## Install / run from source

**Requirements:** [Node.js](https://nodejs.org/), [Rust](https://rustup.rs/), and the usual [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
npm install
npm run tauri dev
```

Production installers/binaries:

```bash
npm run tauri build
```

Outputs appear under `src-tauri/target/release/bundle/` (platform-dependent).
