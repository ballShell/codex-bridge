# Codex Bridge Execution Duration Constraints (Soft + Hard)

**Date:** 2026-11-25  
**Approach:** Option A — Single Primary Budget (`max_duration_seconds`) + Optional Idle Cap (`max_idle_seconds`)

## 1. Motivation

Previously, `codex_plan`, `codex_run`, and `codex_review` only accepted `wait_seconds` (controlling how long the initial MCP call waits synchronously before returning `status: "running"`). Subprocesses had no hard wall-clock or idle deadline and could run for 20+ minutes due to either unconstrained exploration loops or upstream custom-provider stalls.

## 2. Design Overview

The main model (Gemini) estimates a realistic execution budget per task and passes `max_duration_seconds` (plus optional `max_idle_seconds`). `codex-bridge` enforces two coordinated layers:

### Layer 1: Soft Constraint (Automatic Prompt Time-Budget Injection)
- Triggered automatically for `codex_plan`, `codex_run`, and prompt-bearing `codex_review` (`mode="custom"` or `prompt` provided).
- Computes `soft_budget_seconds = max(1, int(max_duration_seconds * 0.8))` (80% target, reserving 20% for wrap-up & verification).
- Appends a concise `[Execution Time Budget — Soft Constraint]` block to the prompt sent to `codex`, instructing Codex to:
  - aim to finish within `~soft_budget_seconds`,
  - prioritize high-impact work and avoid broad scans outside scope,
  - stop exploring and output a partial summary + remaining items if approaching the deadline.
- Preserves the clean user prompt in `prompt_preview` (never leaks boilerplate into monitor UI titles).
- For native prompt-less `codex exec review --uncommitted/--base/--commit`, sets `soft_budget_injected: false` while still enforcing the full Layer 2 hard watchdog.

### Layer 2: Hard Constraint (Process-Group Watchdog)
- Every launched task carries:
  - `max_duration_seconds`: integer in `[1, 3600]`, default `900` (15 min).
  - `max_idle_seconds`: optional integer in `[1, 3600]`, default `None` (clamped to `<= max_duration_seconds` if larger).
- A daemon `_watchdog_loop` checks elapsed time (`time.monotonic() - start_monotonic`) and idle time (`time.monotonic() - last_event_monotonic`) every ≤0.25s.
- When `max_duration_seconds` or `max_idle_seconds` is exceeded while `proc.poll() is None`:
  1. Records `timed_out = True`, `timeout_reason = "max_duration" | "max_idle"`, and human-readable `timeout_detail`.
  2. Terminates the entire process group via `os.killpg(proc.pid, signal.SIGTERM)`, waits a brief grace window (`min(2.0, max(0.3, max_duration_seconds * 0.25))`), then escalates to `os.killpg(proc.pid, signal.SIGKILL)` if still alive.
- `_collect_task` safely joins reader threads (bounded timeout after kill), computes `changed_files` / `diff_stat`, preserves any captured `session_id` and partial `summary`, and persists:
  - `status: "failed"` (backwards-compatible with `codex_monitor` and all existing callers),
  - `activity: "timed_out"`,
  - `timed_out: true`, `timeout_reason: "max_duration" | "max_idle"`,
  - `max_duration_seconds`, `max_idle_seconds`, `soft_budget_seconds`, `soft_budget_injected`,
  - `resume_failed: false` (never misclassifies a timeout during resume as a missing session) with an actionable `hint`.
- Running snapshots (`codex_poll` / `async_mode` / persisted task JSON) expose `max_duration_seconds`, `max_idle_seconds`, `soft_budget_seconds`, and `remaining_ms`.

## 3. Main-Model Estimation Guidance (Rules & Skills)

`rules/AGENTS.md`, `skills/codex-architect/SKILL.md`, `skills/codex-subagent/SKILL.md`, and `agents/codex-worker.md` instruct the main model to estimate `max_duration_seconds` (and optional `max_idle_seconds`) based on task complexity:
- Quick Q&A / small diff review (≤5 files): `max_duration_seconds=180..300`, `max_idle_seconds=120..180`
- Medium plan / single-module edit: `max_duration_seconds=300..600`, `max_idle_seconds=180..300`
- Heavy architecture / multi-file refactor: `max_duration_seconds=600..1200`, `max_idle_seconds=300..420`
