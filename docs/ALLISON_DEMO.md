# Five-minute demo: AgentArena AI × HarnessRouter

> **Honesty rule for the presenter:** this demo runs in **DEMO MODE**. The agents are deterministic simulations. **The code they return is evaluated for real**: executed in a network-less Docker sandbox and statically analysed. Say this out loud. Never present the demo numbers as a live benchmark of real agents.

## Before you start (2 minutes, offline)

```bash
npm run db:up
npm run dev   # http://127.0.0.1:3100
```

Open the dashboard. If history is empty, run `npm run db:seed` first (about 2 minutes; it uses the real pipeline).

## 0:00 – 0:40 · The problem

"Teams pick coding agents by vibes and demos. A response that *sounds* right isn't the same as code that passes tests. HarnessRouter already makes Codex, Claude Code, Hermes and others interchangeable behind one API, and its Arena compares time and cost side by side. AgentArena adds the missing layer: **objective evidence**. We execute what each agent produced, grade it, and route future tasks on that record."

## 0:40 – 1:20 · HarnessRouter's role (Settings, then ARCHITECTURE)

- One adapter talks to HarnessRouter: `POST /v1/responses` with `metadata.harness_id`, data-only SSE, `Idempotency-Key`, cancel, `spend_usd`, and changed files.
- Swapping agents means changing a harness id, not writing a new integration. That is the value of the Unified Harness Protocol.
- Show Settings: the key is server-side only, the base URL works for Cloud or Community Edition, and live mode needs two explicit switches plus a per-benchmark spend confirmation.

## 1:20 – 2:50 · Run a benchmark (New benchmark → Arena)

1. Pick **"Parse human-readable durations"**. Point out the declarative tests: data, never code, and expected values never enter the sandbox.
2. Keep all three simulated agents and the **Balanced** profile. Point at the scoring formula panel.
3. Click **Launch** and watch the Live Arena: real events per column (tool calls, streamed text), elapsed time, and a **Cancel** button per run.
4. Results appear in about 15 seconds.

## 2:50 – 3:50 · The comparison (Results)

- "Erratic Explorer passed **7/7 tests** and was fast, yet it's ranked **below** Careful Tester. Look at the evidence: it used `eval()`. That's a high-severity security finding, and our ranking gate never lets that win."
- Open Swift Drafter's evidence: `garbage returns null → expected null, got 0`. That is a concrete, reproducible failure, not an opinion.
- Point out the coverage %, the "—" means *not measured* (never zero), the cost tag **simulated**, and the isolation line (network none, read-only, non-root).
- Open the fairness audit: the exact prompt every agent received.

## 3:50 – 4:30 · Smart router

- Enter "Fix the session expiry bug in our TypeScript auth middleware". The router shows its keyword signals, a recommendation with **low confidence** (only 3 runs each), the formula, the alternative, and the caveats ("within 0.03, treat as equivalent", "evidence is SIMULATED").
- Change the language to something without data and show **"Insufficient benchmark evidence for a reliable recommendation."** The router declines instead of guessing.

## 4:30 – 5:00 · Why it matters, and next

**Technical differentiators:** execution-based grading in an isolated sandbox · host-side comparison that a solution cannot forge · missing ≠ zero · security gate · reproducible scores (`npm run eval:rerun` → 0 changes) · minimum-evidence routing · demo and live data never mixed.

**Student workshop potential (AAST College of AI):**
- *Lab 1:* write a benchmark task and test spec, and discuss what makes an evaluation fair.
- *Lab 2:* add a static-analysis rule or a language runner.
- *Lab 3:* with HarnessRouter credits, run live benchmarks of two configured agents and publish the class leaderboard with confidence intervals.
- *Lab 4:* once real data exists, train and validate a learned router against the rules baseline.

**Roadmap:** live gate verification → repository-level tasks with the repo's own test suite → worker queue → trace ingestion from `/v1/traces` → auth for a shared class instance.
