import Image from "next/image";
import compoundHero from "@/assets/compound.png";

function IconAgents() {
  return (
    <svg
      className="size-8 text-cyan-400"
      fill="none"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="16" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="8" cy="24" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="24" cy="24" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M16 11v7M13 21l-3 3m12-3 3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function IconDiff() {
  return (
    <svg
      className="size-8 text-violet-400"
      fill="none"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6 10h12M6 16h20M6 22h14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M22 10l3 3-3 3"
        stroke="#34d399"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconExplore() {
  return (
    <svg
      className="size-8 text-fuchsia-400"
      fill="none"
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="5"
        y="7"
        width="22"
        height="18"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M10 13h8M10 17h12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.55"
      />
      <circle cx="23" cy="20" r="3.5" stroke="#22d3ee" strokeWidth="1.5" />
    </svg>
  );
}

export default function Home() {
  return (
    <div className="relative flex min-h-full flex-1 flex-col overflow-hidden">
      <div className="pointer-events-none absolute inset-0 dev-grid" />
      <div className="pointer-events-none absolute inset-0 dev-radial" />

      <header className="relative z-10 border-b border-zinc-800/80 bg-zinc-950/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <span className="font-mono text-sm tracking-tight text-zinc-100">
            compound
          </span>
          <nav className="flex items-center gap-6 text-sm text-zinc-400">
            <a href="#workflow" className="transition-colors hover:text-zinc-100">
              Workflow
            </a>
            <a href="#features" className="transition-colors hover:text-zinc-100">
              Features
            </a>
          </nav>
        </div>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pb-24 pt-16 md:pb-32 md:pt-24">
        <section className="flex flex-col items-center gap-10 md:flex-row md:items-center md:justify-between md:gap-16">
          <div className="max-w-xl flex-1 text-center md:text-left">
            <p className="mb-4 inline-flex items-center rounded-full border border-zinc-700 bg-zinc-900/80 px-3 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-400">
              Developer tool
            </p>
            <h1 className="text-balance text-4xl font-semibold tracking-tight text-zinc-50 md:text-5xl">
              Orchestrate agents on real repos—not toy demos.
            </h1>
            <p className="mt-5 text-pretty text-lg leading-relaxed text-zinc-400">
              Compound keeps coding agents grounded in your tree, diffs, and
              terminals so you stay in flow: delegate work, inspect every change,
              and explore unfamiliar code without losing the thread.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3 md:justify-start">
              <span className="rounded-lg border border-zinc-700 bg-zinc-900/60 px-4 py-2 font-mono text-xs text-zinc-300">
                <span className="text-emerald-400">●</span> agents · reviews ·
                exploration
              </span>
            </div>
          </div>

          <div className="relative shrink-0">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-cyan-500/15 via-transparent to-violet-500/15 blur-2xl" />
            <div className="relative rounded-[1.75rem] border border-zinc-700 bg-zinc-900/40 p-6 shadow-2xl shadow-black/40 backdrop-blur-sm">
              <Image
                src={compoundHero}
                alt="Compound logo"
                width={280}
                height={280}
                priority
                placeholder="blur"
                className="rounded-2xl"
              />
            </div>
          </div>
        </section>

        <section
          id="workflow"
          className="mt-28 border-t border-zinc-800/90 pt-16 md:mt-36 md:pt-24"
        >
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan-400/90">
            How teams use it
          </p>
          <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight text-zinc-50 md:text-3xl">
            A tighter loop between humans and autonomous edits.
          </h2>
          <ol className="mt-12 grid gap-6 md:grid-cols-3">
            {[
              {
                step: "01",
                title: "Compose",
                body: "Fan out tasks across agents with repo context wired in—paths, modes, and constraints stay explicit.",
              },
              {
                step: "02",
                title: "Review",
                body: "Surface diffs where they belong: beside file trees and terminals so judgment stays cheap.",
              },
              {
                step: "03",
                title: "Ship",
                body: "Walk exports with confidence—every exploration thread traces back to files you trust.",
              },
            ].map((item) => (
              <li
                key={item.step}
                className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-6"
              >
                <span className="font-mono text-xs text-zinc-500">{item.step}</span>
                <h3 className="mt-2 font-medium text-zinc-100">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {item.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section id="features" className="mt-28 md:mt-36">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-violet-400/90">
            Built for engineers
          </p>
          <h2 className="mt-3 max-w-xl text-2xl font-semibold tracking-tight text-zinc-50 md:text-3xl">
            Opinionated UX for messy systems.
          </h2>

          <div className="mt-12 grid gap-8 md:grid-cols-3">
            <article className="group rounded-xl border border-zinc-800 bg-zinc-950/40 p-8 transition-colors hover:border-zinc-700 hover:bg-zinc-950/70">
              <IconAgents />
              <h3 className="mt-6 font-semibold text-zinc-100">
                Orchestrating agents
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Coordinate multiple agents against the same checkout—parallelize
                refactors, migrations, and investigations without stepping on each
                other&apos;s edits.
              </p>
              <p className="mt-4 font-mono text-[11px] leading-relaxed text-zinc-500">
                queues · terminals · repo-aware prompts
              </p>
            </article>

            <article className="group rounded-xl border border-zinc-800 bg-zinc-950/40 p-8 transition-colors hover:border-zinc-700 hover:bg-zinc-950/70">
              <IconDiff />
              <h3 className="mt-6 font-semibold text-zinc-100">
                Reviewing changes
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Treat agent output like a teammate&apos;s branch: scan hunks in
                context, flip between sides of the tree, and reject noise before it
                lands.
              </p>
              <p className="mt-4 font-mono text-[11px] leading-relaxed text-zinc-500">
                structured diffs · blame-ready flows · fewer surprises
              </p>
            </article>

            <article className="group rounded-xl border border-zinc-800 bg-zinc-950/40 p-8 transition-colors hover:border-zinc-700 hover:bg-zinc-950/70">
              <IconExplore />
              <h3 className="mt-6 font-semibold text-zinc-100">
                Code exploration
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-zinc-400">
                Navigate sprawling modules without breaking focus—jump symbols,
                follow imports, and map architecture while agents keep working.
              </p>
              <p className="mt-4 font-mono text-[11px] leading-relaxed text-zinc-500">
                trees · semantic zoom · keyboard-first paths
              </p>
            </article>
          </div>
        </section>
      </main>

      <footer className="relative z-10 border-t border-zinc-800/90 bg-zinc-950/80 py-10 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 text-center md:flex-row md:text-left">
          <span className="font-mono text-sm text-zinc-500">
            compound · ship with agents in the loop
          </span>
          <span className="font-mono text-xs text-zinc-600">
            Local-first mindset · built for serious repos
          </span>
        </div>
      </footer>
    </div>
  );
}
