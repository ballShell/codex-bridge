# Codex Bridge — Antigravity Plugin Design Spec

- **Status:** Ready for User Approval (Builder Check Completed)
- **Date:** 2026-11-21
- **Plugin Identifiers:** `name: "codex-bridge"`, `displayName: "Codex Bridge"`
- **Target Distribution:** Public GitHub repository (`agy plugin install https://github.com/<owner>/<repo>`) and Antigravity Marketplace submission (`agy plugin validate --strict`)

---

## 1. Intent & Why

Different coding models excel at different parts of the software lifecycle:
- **Antigravity (Gemini)** excels at fluent, empathetic human dialogue: asking clarifying questions, surfacing trade-offs in plain language, structuring vague product ideas, and summarizing technical outcomes clearly.
- **OpenAI Codex CLI** excels at heavy repository-scale engineering: backend architecture, complex cross-file refactoring, deep static reasoning, and code review.

Today, Antigravity has no official or partner Marketplace plugin that exposes Codex as a controllable subagent. Meanwhile, existing community bridges mostly either run in the reverse direction (letting Codex invoke `agy`) or target the deprecated/removed `codex mcp-server` subcommand.

**Codex Bridge** turns Antigravity into a seamless **"Translator & Orchestrator + Heavy Worker"** dual-model workflow:
1. Gemini serves as the conversational front-of-house: interviewing the user, clarifying ambiguity, translating human intent into high-density engineering briefs, and translating Codex's work back into plain human language.
2. Codex serves as the on-demand engineering specialist: accessible both via structured two-phase planning/execution for heavy tasks and via frictionless ad-hoc invocation whenever the user explicitly asks Codex to do a small or medium task.

---

## 2. Goals, Non-Goals, and Anti-Goals

### Goals
- **Conversational Translator Layer**: Bundle always-on plugin rules and progressive-disclosure skills that teach Antigravity's main agent how to clarify requirements before dispatching Codex, write structured engineering briefs, and verify + translate Codex output back into human language.
- **Intelligent Routing (Hybrid Execution)**: Gemini handles conversation, light edits (e.g., copy, minor UI/config tweaks), and quick workspace lookups directly; heavy architecture design, backend core logic, complex multi-file refactors, and deep reviews route to Codex.
- **Mode A (Two-Phase Controllable Execution for Complex Changes)**: Heavy design/implementation tasks default to Phase 1 (`codex_plan`, strictly `-s read-only`) -> Gemini translates the plan for user confirmation -> Phase 2 (`codex_run` resuming the same `session_id` with `workspace-write`) implements and verifies.
- **Ad-Hoc / On-Demand Subagent Experience**: Users can explicitly ask Codex to handle any small or targeted task (e.g., "let Codex write this parser", "have Codex review my diff") and Gemini invokes Codex immediately without forcing heavy multi-stage project ceremony, while still retaining `session_id` for follow-up turns.
- **Zero-Dependency GitHub & Marketplace Readiness**: Run out-of-the-box on macOS/Linux using Python 3.9+ standard library only (`pip`/`npm`/`uv`-free), use `${PLUGIN_ROOT}` / `${PLUGIN_DATA}`, pass `agy plugin validate --strict`, and avoid Marketplace naming/layout violations.

### Non-Goals
- Replacing Gemini for every trivial read, greeting, or single-line edit when the user hasn't asked for Codex.
- Building against the removed `codex mcp-server` command or the `[experimental]` `codex app-server` protocol.
- Bundling or storing OpenAI credentials in the plugin repository (users authenticate via local `codex login` or environment variables).
- Building an MCP App HTML GUI in v1 (plain structured text/JSON results work cleanly across Antigravity App, IDE, and CLI).
- Isolated Git `--worktree` lifecycle management in v1 (deferred to v2; `codex exec resume --worktree` is unsupported by Codex CLI anyway, and v1 focuses on Mode A in the primary `cwd`).

### Anti-Goals
- **Never allow `codex_plan` to write files**: Phase 1 planning and read-only inquiries must enforce `-s read-only` at the subprocess boundary, not merely via prompt wording.
- **Never expose unsandboxed `danger-full-access` execution by default**: Unsandboxed runs must be rejected server-side unless the user explicitly opts in via `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX=1`.
- **Never forward raw vague prompts blindly**: Gemini must not pass `"make it better"` straight to Codex without workspace context, constraints, and acceptance criteria.
- **Never dump raw `codex --json` JSONL streams to the user**: Gemini must inspect/verify the changes and translate outcomes into human language.
- **Never place `AGENTS.md` at repository root**: Antigravity plugin rules live strictly under `rules/AGENTS.md`; a root `AGENTS.md` triggers multi-tool validation warnings.

---

## 3. Constraints & Verified Platform Facts

1. **Installed Codex CLI Behavior (verified on `codex-cli 0.171.0-alpha.13`)**:
   - `codex mcp-server` does **not** exist in modern Codex CLI.
   - `codex app-server` is marked `[experimental]`.
   - Stable non-interactive commands are:
     - `codex exec [OPTIONS] [PROMPT]` (supports `-s/--sandbox <read-only|workspace-write|danger-full-access>`, `-C/--cd <DIR>`, `-m/--model`, `-c <key=value>`, `--skip-git-repo-check`, `--json`, `-o/--output-last-message <FILE>`, `-i/--image <FILE>`).
     - `codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]` (supports `-c`, `-m`, `--skip-git-repo-check`, `--json`, `-o`, `-i`; note: `resume` does **not** accept `-s`/`--sandbox` or `-C`/`--cd` CLI flags — working directory must be set via subprocess `cwd`, and sandbox mode override via `-c sandbox_mode="workspace-write"`; additionally, `--worktree` fails at runtime with `Error: --worktree cannot resume an existing session`, reinforcing our v1 decision to omit `--worktree`).
     - `codex review [OPTIONS] [PROMPT]` (supports `--uncommitted`, `--base <BRANCH>`, `--commit <SHA>`, `--title <TITLE>`, `-c`).
     - `codex login status` (exits/reports whether Codex CLI is authenticated).
   - `codex exec --json` emits newline-delimited JSON events including `thread.started` (with `thread_id`), `turn.started`, and `turn.completed` (with token `usage`).
2. **Antigravity Plugin & Marketplace Spec (`https://antigravity.google/schemas/v1/plugin.json`)**:
   - `name` must match `^[a-z0-9]+(-[a-z0-9]+)*$` (`codex-bridge`).
   - `displayName` (`Codex Bridge`) must not start with `"Antigravity"`, `"Gemini"`, `"Claude"`, or `"Cursor"`, and must not end with `"Plugin"` or `"MCP"`.
   - Required Marketplace fields: `name`, `displayName`, `description` (120–160 chars), `version` (`semver`), `logo` (bundled 1:1 square icon `>=128x128px` with ~10% margin, e.g., `assets/logo.svg`), `author`.
   - `SKILL.md` frontmatter `name` must match its parent directory name (`skills/<name>/SKILL.md`).
   - `mcp_config.json` expands `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` natively; server tools are namespaced by Antigravity as `codex-bridge_<serverName>`, e.g., `codex-bridge_codex` (avoid duplicating `PLUGIN_ROOT`/`PLUGIN_DATA` inside `"env"`).
   - `mcp_config.json` supports `timeoutSeconds` (default 180s), `tools.<tool>.eager: true` (for direct upfront tool registration), and `tools.<tool>.background` (`"always"` / `"off"`).
   - Custom agents under `agents/<name>.md` support `subagent: true`, `mainAgent: false`, `inheritMcp: true`.
3. **Runtime Floor**:
   - Python `>= 3.9` standard library only (`python3`, verified `3.9.6` locally). Zero third-party PyPI packages, zero Node/npm install requirements, no `uv` required.
   - macOS / Linux POSIX support primary (uses `subprocess`, `shutil.which`, `pathlib`, `json`, `threading`, `tempfile`).

---

## 4. Approaches Considered & Selection

| Approach | Summary | Trade-offs | Decision |
| :--- | :--- | :--- | :--- |
| **1. Zero-Dependency Stdio MCP Server wrapping `codex exec / resume / review` + Rules/Skills/Subagent** | Bundle a Python 3 stdlib stdio MCP server launched via `mcp_config.json` (`${PLUGIN_ROOT}`), exposing `codex_status`, `codex_plan`, `codex_run`, `codex_poll`, `codex_review`, paired with translator `rules/AGENTS.md`, workflow `skills/`, and optional `agents/codex-subagent.md`. | **Pros:** Uses stable non-experimental CLI commands; zero install dependencies (`git clone` ready); clean MCP schema enforces read-only vs write phases; supports `session_id` continuity.<br>**Cons:** ~0.5–1s CLI subprocess cold start per turn; no mid-turn interactive shell-command approval prompts. | **Selected** |
| **2. Persistent `codex app-server` JSON-RPC Bridge (Node/TS)** | Long-lived Node/TS MCP server connecting to `codex app-server --stdio`. | **Pros:** Warm daemon, granular streaming & approval callbacks.<br>**Cons:** `codex app-server` is explicitly `[experimental]` and subject to breaking protocol shifts; requires JS build/deps. | Rejected |
| **3. Pure Skills/Rules + `run_command` Shell Invocation (No MCP)** | No MCP server; Gemini invokes `codex exec` directly via `run_command`. | **Pros:** Minimal code, uses native terminal background tasks.<br>**Cons:** Fragile CLI flag construction by LLM, no structured MCP contract/sandbox enforcement, invisible in Antigravity MCP panel, weaker open-source plugin DX. | Rejected |

---

## 5. Architecture & Component Design

### 5.1 Plugin Repository Layout

```text
Antigravity-codex-bridge/          # Published as GitHub repo root (plugin root)
├── .gitignore
├── README.md                      # User docs + AgentsWorkSpace status header
├── plugin.json                    # Antigravity plugin manifest
├── mcp_config.json                # Registers `codex` stdio MCP server via ${PLUGIN_ROOT}
├── assets/
│   └── logo.svg                   # 1:1 square vector logo legible on light & dark themes
├── rules/
│   └── AGENTS.md                  # Always-on translator identity & smart routing rules
├── skills/
│   ├── codex-architect/
│   │   └── SKILL.md               # Mode A two-phase workflow (clarify -> codex_plan -> confirm -> codex_run)
│   └── codex-subagent/
│       └── SKILL.md               # Ad-hoc / on-demand Codex dispatch & review workflow
├── agents/
│   └── codex-worker.md            # Optional Antigravity subagent (subagent: true, inheritMcp: true) for parallel dispatch
├── scripts/
│   ├── codex_mcp_server.py        # Zero-dependency stdio MCP server (executable 0755)
│   └── codex_runner.py            # Shared Codex CLI invocation, JSONL parsing, & background task manager
└── tests/
    ├── fake_codex.py              # Mock `codex` binary simulating exec, resume, review, login, errors
    ├── test_codex_runner.py       # Unit & integration tests for runner + fallback logic
    └── test_mcp_server.py         # End-to-end stdio JSON-RPC MCP protocol tests
```

*(Note: No `AGENTS.md` at the repository root so Antigravity plugin validation runs cleanly with 0 warnings.)*

### 5.2 Manifest (`plugin.json`) & MCP Config (`mcp_config.json`)

- **`plugin.json`**:
  - `$schema`: `"https://antigravity.google/schemas/v1/plugin.json"`
  - `name`: `"codex-bridge"`
  - `displayName`: `"Codex Bridge"`
  - `version`: `"0.1.0"`
  - `description`: `"Pair Gemini's conversational clarity with OpenAI Codex CLI as an on-demand subagent for architecture, backend implementation, and code review."`
  - `logo`: `"assets/logo.svg"`
  - `suggestedPrompts` (3 chips):
    1. `"Design and implement a new backend feature with Codex (plan first, then build)"`
    2. `"Ask Codex to inspect this repo and propose a refactoring plan"`
    3. `"Have Codex review my uncommitted changes and translate the findings"`
  - `license`: `"MIT"`, `keywords`: `["codex", "openai", "subagent", "translator", "code-review", "architecture"]`
  - `author` / `homepage` / `repository`: configurable placeholders updated before/upon GitHub push.

- **`mcp_config.json`**:
  - Server key: `"codex"` (Antigravity namespaces as `codex-bridge_codex`).
  - `command`: `"python3"`
  - `args`: `["${PLUGIN_ROOT}/scripts/codex_mcp_server.py", "--data-dir", "${PLUGIN_DATA}"]`
  - `timeoutSeconds`: `900` (15 minutes, preventing default 180s cutoff on heavy backend tasks).
  - `tools`:
    - `codex_status`: `{ "eager": true, "background": "off" }`
    - `codex_plan`: `{ "eager": true }`
    - `codex_run`: `{ "eager": true }`
    - `codex_review`: `{ "eager": true }`
    - `codex_poll`: `{ "eager": false }` (lazy-loaded fallback used only when a call returns `status: "running"` with a `task_id`).
  - *(Design call: Do not force `"background": "always"` on `codex_plan`/`codex_run` in v1 because quick ad-hoc tasks finish in 5–20s and feel snappier foreground, while our server itself supports optional `wait_seconds` / internal async task tracking via `codex_poll` if a run exceeds the foreground wait threshold or when the caller explicitly passes `async_mode: true`.)*

### 5.3 MCP Server & Runner Design (`scripts/codex_mcp_server.py` + `scripts/codex_runner.py`)

#### Protocol Support (`codex_mcp_server.py`)
- Implements MCP stdio transport (newline-delimited JSON-RPC 2.0 over `stdin`/`stdout`; all diagnostic logging strictly to `stderr`).
- Handles: `initialize` (returns `protocolVersion`, `capabilities: {"tools": {}}`, `serverInfo`, and concise `instructions`), `notifications/initialized`, `ping`, `tools/list`, `tools/call`.
- Concurrent-safe: handles tool execution without corrupting stdout framing (lock around `stdout.write` + `flush`).

#### Codex Executable Resolution, Path Validation, & Preflight
- Resolves binary via: `CODEX_BIN` env var (if set) -> `shutil.which("codex")` -> common Homebrew fallback paths (`/opt/homebrew/bin/codex`, `/usr/local/bin/codex`).
- **Path & Sandbox Guardrails** (resolved & confirmed during Builder Check):
  - Every tool accepting `cwd` validates that `cwd` resolves to an existing directory (failing fast with a clear JSON error otherwise). *(Builder call: keep `cwd` open to any valid existing directory rather than hardcoding a single root so multi-repo workspaces work, while always enforcing `read-only` / `workspace-write` sandboxing and teaching Gemini via `rules/AGENTS.md` to confirm with the user before targeting directories outside the active workspace.)*
  - `codex_run` exposes `sandbox: "workspace-write" | "read-only"` by default. `danger-full-access` is rejected server-side with an actionable error unless `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX=1` is explicitly set in the user's environment (e.g., inside `mcp_config.json` `env` or shell environment).
- Auth check in `codex_status`: runs `codex login status` and checks whether `OPENAI_API_KEY` / custom base config exists (reporting boolean `configured: true/false` without ever echoing key values). Returns clear remediation steps (`codex login` or setting `OPENAI_API_KEY`) when unauthenticated.

#### Tool Contracts (5 Tools)

1. **`codex_status(cwd?: string)`**
   - Checks Codex binary path, `codex --version`, auth status, and whether `cwd` is a Git repository (`git rev-parse --is-inside-work-tree`, current branch, dirty status).
   - Fast foreground check before dispatching heavy work or when debugging setup issues.

2. **`codex_plan(prompt: string, cwd: string, model?: string, reasoning_effort?: string, images?: string[], wait_seconds?: integer)`**
   - Always enforces `-s read-only`, `-C <cwd>`, `--json`, `-o <tmp_last_msg>`, and `--skip-git-repo-check` (if `cwd` is not a Git repo).
   - Does **not** pass `--ephemeral`, so Codex persists the rollout and emits `thread_id` (`session_id`) for Phase 2 `resume`.
   - Parses JSONL events from stdout (`thread.started` -> `session_id`, `turn.completed` -> token usage, tool/error summaries) and reads `-o <tmp_last_msg>` as the primary response text (falling back to parsed agent message items or stdout/stderr if `-o` is empty).
   - Returns structured JSON text payload:
     ```json
     {
       "status": "completed | running | failed",
       "session_id": "<thread_id>",
       "task_id": "<optional if running>",
       "sandbox": "read-only",
       "summary": "<Codex final markdown output>",
       "usage": {"input_tokens": 0, "output_tokens": 0},
       "elapsed_ms": 1234,
       "error": null
     }
     ```

3. **`codex_run(prompt: string, cwd: string, session_id?: string, sandbox?: "workspace-write" | "read-only" | "danger-full-access", model?: string, reasoning_effort?: string, images?: string[], async_mode?: boolean, wait_seconds?: integer)`**
   - Defaults: `sandbox = "workspace-write"`, `async_mode = false`, `wait_seconds = 120` (if exceeded before Codex finishes, transitions cleanly to background and returns `status: "running"` + `task_id` for `codex_poll`, avoiding silent timeout hangs!).
   - **Sandbox enforcement**: Tool description advertises `"workspace-write"` (default) and `"read-only"`. Passing `"danger-full-access"` is rejected unless `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX=1` is set in the environment.
   - **Fresh task (`session_id` omitted)**:
     - Invokes `codex exec --json -s <sandbox> -C <cwd> -o <tmp_last_msg> [--skip-git-repo-check] ... <prompt>`.
   - **Resumed task (`session_id` provided — Mode A Phase 2 or multi-turn follow-up)**:
     - Invokes `codex exec resume <session_id> --json -o <tmp_last_msg> -c sandbox_mode="<sandbox>" [--skip-git-repo-check] ... <prompt>` with subprocess `cwd=<cwd>`.
     - **Important fallback guard**: Because `codex exec resume` does not accept `-s`/`-C` flags directly and relies on `-c sandbox_mode=...`, if `codex exec resume` fails due to session/sandbox incompatibility or missing session file, return a structured `resume_failed` error hint (or optional automatic fallback flag) so Gemini knows cleanly whether to retry with a fresh `codex_run` carrying the approved plan context.
   - **Post-run workspace diff summary**: If `cwd` is a Git repo and `sandbox != "read-only"`, runs `git status --short` + `git diff --stat` in `cwd` (captured against pre-run baseline or current dirty state) and includes changed file summary in the returned JSON so Gemini always sees exact touched files. *(Builder call: capture a quick pre-run `git status --porcelain` snapshot before invoking Codex so pre-existing dirty files are clearly distinguished from newly changed/untracked files.)*

4. **`codex_poll(task_id: string, wait_seconds?: integer)`**
   - Waits up to `wait_seconds` (default `30`, max `300`) for a running background task (`codex_plan` or `codex_run`) persisted in `${PLUGIN_DATA}/tasks/<task_id>.json` (or in-memory registry backed by `${PLUGIN_DATA}`), returning current status (`running` with latest partial JSONL progress line count / elapsed time, or `completed` / `failed` with full structured result).

5. **`codex_review(cwd: string, mode?: "uncommitted" | "base" | "commit", base_branch?: string, commit_sha?: string, title?: string, prompt?: string)`**
   - Wraps `codex review` in `cwd`:
     - `uncommitted` (default when no `base_branch`/`commit_sha` given): `codex review --uncommitted [prompt]`
     - `base`: `codex review --base <base_branch> [prompt]`
     - `commit`: `codex review --commit <commit_sha> [--title <title>] [prompt]`
   - Note: Verify `codex review` behavior if both `--uncommitted` and `[PROMPT]` are passed (in `codex review --help`, `[PROMPT]` is listed alongside `--uncommitted`, `--base`, `--commit`; handle cleanly if CLI treats them mutually exclusive in certain sub-cases).

### 5.4 Translator Layer & Behavior Design (`rules/AGENTS.md` + `skills/` + `agents/`)

#### Always-on Rule (`rules/AGENTS.md`, concise to respect 24KB / token budget)
Defines Antigravity's core persona & routing contract when `codex-bridge` is enabled:
1. **Translator Identity**: Gemini is the user-facing communicator, clarifier, and verifier. Never expose raw JSONL or force the user to craft Codex prompts themselves.
2. **Smart Routing**:
   - **Handle Directly (Gemini)**: Requirement interviews, small/local edits (copy, docs, small config tweaks), quick file lookups, explaining code.
   - **Route to Codex**:
     - *Heavy tasks (Mode A — Two-Phase)*: Repository architecture design, complex backend features, multi-file refactors, tricky concurrency/algorithm debugging -> Activate `codex-translator` (`codex-architect`) skill: clarify with user first -> `codex_plan` (read-only) -> translate plan & ask user confirmation -> `codex_run` (`session_id` resume, `workspace-write`) -> verify & translate result.
     - *Ad-hoc / Explicit user delegation*: Whenever the user explicitly says "让 Codex ..." / "use Codex to ...", obey immediately via `codex-subagent` skill—use `codex_plan` for read-only analysis/questions, `codex_review` for review, or `codex_run` directly for small/bounded tasks unless the request is broad/high-risk.
3. **Engineering Brief Standard**: Every prompt sent to Codex must be translated into structured engineering terms:
   - Goal & non-goals
   - Target repository path (`cwd`) & key file paths/symbols already identified
   - Technical constraints, stack conventions, and edge cases clarified with the user
   - Concrete acceptance & verification criteria (tests/commands Codex should run)
4. **Result Translation & Sanity Check**: After `codex_run` returns, Gemini inspects `changed_files` / key diffs (and runs quick sanity tests if Codex didn't already), then summarizes in clear human language: what changed, why, verification evidence, and any open choices.

#### Skills (`skills/`)
1. **`skills/codex-architect/SKILL.md`** (`name: codex-architect`):
   - Step-by-step Mode A playbook:
     1. **Preflight**: If uncertain, call `codex_status`.
     2. **Conversational Discovery**: Ask focused plain-language questions to resolve missing goals, constraints, API contracts, and edge cases.
     3. **Brief Translation & Phase 1 (`codex_plan`)**: Synthesize answers into a structured brief and call `codex_plan`.
     4. **Human-Readable Plan Review**: Translate Codex's technical proposal into digestible architecture bullets, trade-offs, and affected files for user sign-off.
     5. **Phase 2 Execution (`codex_run`)**: After user approves, pass `session_id` to `codex_run` (`workspace-write`) with any user refinements (falling back to a fresh `codex_run` carrying the approved plan if resume fails).
     6. **Verification & Human Summary**: Inspect changed files / test output and deliver a concise summary.
2. **`skills/codex-subagent/SKILL.md`** (`name: codex-subagent`):
   - Fast-path playbook for **"随调随用" (on-demand subagent)**:
     - Explicit small code edit/script -> translate brief -> `codex_run` directly (or `codex_plan` first if ambiguous/destructive).
     - Explicit code review -> `codex_review`.
     - Follow-up tweak on previous Codex work -> `codex_run` with previous `session_id`.
     - Poll loop handling when `status == "running"`.

#### Optional Parallel Subagent (`agents/codex-worker.md`)
- Frontmatter:
  - `name: codex-worker`
  - `description: Background Antigravity subagent that wraps Codex Bridge MCP tools for parallel read-only exploration or disjoint file-slice implementation.`
  - `subagent: true`, `mainAgent: false`, `inheritMcp: true`, `model: flash`
  - `tools: [read_file, call_mcp_tool, send_message]` (Note: verify exact tool names against Antigravity's subagent tool-validation caveat — remember `subagents.md` warns unmapped tool names can hang a subagent! Test or inspect exact active tool names before finalizing `agents/codex-worker.md`, or rely on `inheritMcp: true` + verified Antigravity built-in tool names like `read_file` and `send_message`!).
- **Parallel safety rule (v1 without worktree)**: Because v1 operates directly in `cwd`, parallel `codex-worker` instances may run simultaneously **only** for read-only `codex_plan` / `codex_review` tasks OR when the orchestrator explicitly assigns disjoint non-overlapping file ownership slices to each worker. *(Builder call: enforce this ownership convention in `rules/AGENTS.md` and `agents/codex-worker.md` until v2 adds worktree isolation.)*

---

## 6. Verification & Testing Strategy

1. **Automated Unit & Protocol Tests (`tests/`, stdlib `unittest`)**:
   - Mock `codex` CLI executable (`tests/fake_codex.py`) invoked via `CODEX_BIN` environment override.
   - Verify:
     - `codex_status` handles ready state, missing binary, and `Not logged in`.
     - `codex_plan` always passes `-s read-only`, captures `thread_id`, reads `-o` file, and handles empty `-o` fallback.
     - `codex_run` handles fresh execution, `session_id` resume with `-c sandbox_mode=...`, `resume` failure recovery hint, default rejection of `danger-full-access` (and unlock via `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX=1`), invalid `cwd` rejection, Git pre/post status + diff stat collection, non-Git `--skip-git-repo-check`, and `async_mode` / timeout transition to `codex_poll`.
     - `codex_review` builds `--uncommitted`, `--base`, and `--commit` invocations cleanly.
     - `codex_mcp_server.py` passes full `initialize` -> `tools/list` -> `tools/call` stdio JSON-RPC round-trips cleanly.
2. **Antigravity Plugin Validation**:
   - Validate `plugin.json`, `mcp_config.json`, `skills/*/SKILL.md`, `rules/AGENTS.md`, `agents/*.md`, `assets/logo.svg` via `agy plugin validate --strict` (if `agy` CLI is available locally/in Antigravity bundle) plus a local structural validator script in tests.
3. **Live Smoke Test**:
   - After user signs into `codex`, install plugin locally in `~/.gemini/config/plugins/codex-bridge` (or `.agents/plugins/codex-bridge`) and verify:
     - MCP server connects cleanly in Antigravity.
     - Mode A 2-phase task (`codex_plan` -> approve -> `codex_run` resume) works end-to-end.
     - Ad-hoc small task ("让 Codex 写个小函数并 review") invokes cleanly.

---

## 7. Left to the Builder / Implementation Plan

The implementation plan (`superpowers:writing-plans`) will settle:
- Exact JSON schemas for the 5 MCP tool parameters and returned JSON payloads.
- Exact `codex_runner.py` subprocess process-group cleanup (`start_new_session=True`, SIGTERM -> SIGKILL on cancellation/timeout) and `${PLUGIN_DATA}` task state serialization.
- Exact Antigravity tool names verified for `agents/codex-worker.md` frontmatter.
- Clean 1:1 SVG logo design in `assets/logo.svg` (dual-node bridge motif readable on light and dark themes).
- GitHub-ready bilingual/English `README.md` setup instructions (keeping workspace metadata cleanly at bottom or alongside user docs without violating `AGENTS.md`).
