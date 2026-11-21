# Codex Bridge

Pair **Gemini's conversational clarity** with **OpenAI Codex CLI** as a controllable engineering subagent inside Antigravity.

> **中文简介**：Codex Bridge 将 OpenAI Codex CLI 封装为 Antigravity 原生插件——由 Gemini 担任面向用户的需求翻译与架构编排官（负责多轮澄清、起草工程 Brief、翻译方案并做结果验收），由 Codex 担任深层代码设计、多文件实现与只读代码审查专家；支持“先规划确认、再恢复会话执行”（Mode A）与“随调随用”（On-Demand）两种工作流，零第三方 Python/Node 依赖，开箱即用。

---

## Why Codex Bridge?

- **Gemini as Translator & Orchestrator:** Clarifies vague requirements in your language, drafts structured engineering briefs, translates Codex proposals into plain trade-offs, and verifies touched files without dumping raw JSONL logs.
- **Codex as Engineering Worker:** Executes deep architecture planning (`codex_plan`), workspace edits (`codex_run`), session resumption (`session_id`), and read-only code reviews (`codex_review`) via the stable `codex exec`, `codex exec resume`, and `codex review` CLI commands.
- **Safety by Design:**
  - `codex_plan` and `codex_review` strictly enforce read-only execution at the subprocess boundary.
  - `codex_run` defaults to `workspace-write` and rejects `danger-full-access` unless `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX=1` is explicitly set.
  - Pre-existing dirty files are captured before execution and separated from `changed_files` in the returned summary.
- **Zero External Dependencies:** Pure Python 3.9+ standard library stdio MCP server (`scripts/codex_mcp_server.py`) with bundled rules, progressive-disclosure skills, and a parallel-safe worker subagent.

---

## Architecture & Workflows

```text
User (Natural Language)
  │
  ▼
Antigravity (Gemini) ── rules/AGENTS.md + skills/
  ├── Light edits / Q&A ──────────▶ Handled directly by Gemini
  ├── Heavy tasks (Mode A) ───────▶ codex-architect skill
  │     1. Clarify requirements in plain language
  │     2. codex_plan (-s read-only) -> returns session_id + plan
  │     3. Translate plan & wait for explicit user approval
  │     4. codex_run (resume session_id, workspace-write) -> verify & summarize
  ├── Explicit / quick tasks ─────▶ codex-subagent skill (codex_plan / codex_run / codex_review)
  └── Parallel read-only / slices ▶ codex-worker subagent (read-only or disjoint file slices)
```

---

## Prerequisites

1. **Python 3.9+** (`python3` available on `PATH`).
2. **OpenAI Codex CLI** installed and authenticated:
   ```bash
   # Verify Codex CLI is installed and signed in
   codex --version
   codex login status
   ```
   If not authenticated yet, run `codex login` (or export `OPENAI_API_KEY` in your environment).

---

## Installation

### Option 1: Install via Antigravity CLI (from GitHub)

```bash
agy plugin install https://github.com/<owner>/codex-bridge
```

### Option 2: Local Clone (Development / Manual Install)

Clone or copy this repository into your Antigravity plugins directory as `codex-bridge`:

```bash
git clone https://github.com/<owner>/codex-bridge.git ~/.gemini/config/plugins/codex-bridge
```

Make sure the bundled Python scripts keep their executable permissions (`0755`):

```bash
chmod 755 ~/.gemini/config/plugins/codex-bridge/scripts/codex_mcp_server.py \
          ~/.gemini/config/plugins/codex-bridge/scripts/codex_runner.py
```

---

## Configuration & Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `CODEX_BIN` | Auto-detected (`codex` on `PATH`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`) | Override path to the `codex` CLI binary. |
| `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX` | Unset (`0`) | Set to `1` only if you explicitly want to allow `sandbox="danger-full-access"` in `codex_run`. |

You can set optional environment variables inside your Antigravity plugin/MCP environment if `codex` lives in a non-standard location. Do **not** define `PLUGIN_ROOT` or `PLUGIN_DATA` inside `mcp_config.json` `env`; Antigravity expands `${PLUGIN_ROOT}` and `${PLUGIN_DATA}` natively.

---

## Bundled Components

- **MCP Server (`mcp_config.json` -> `codex-bridge_codex`)**
  - `codex_status` *(eager, foreground)* — Checks binary resolution, version, `codex login status`, `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX`, and target Git repository state.
  - `codex_plan` *(eager)* — Runs `codex exec -s read-only --json` and returns a structured summary plus `session_id`.
  - `codex_run` *(eager)* — Executes a fresh task or resumes an approved `session_id` via `codex exec resume`, reporting `changed_files`, `pre_existing_dirty_files`, `diff_stat`, and structured `resume_failed` hints.
  - `codex_review` *(eager)* — Runs read-only `codex review` in `uncommitted`, `base`, `commit`, or `custom` mode.
  - `codex_poll` *(lazy)* — Polls long-running or `async_mode: true` background tasks persisted under `${PLUGIN_DATA}`.
- **Always-On Rule (`rules/AGENTS.md`)** — Enforces Gemini's translator persona, smart routing, cross-workspace `cwd` confirmation, and post-run verification.
- **Skills (`skills/`)**
  - `codex-architect` — Mode A two-phase workflow (clarify → read-only plan → user sign-off → resumed execution).
  - `codex-subagent` — Fast-path dispatch for direct user delegation, follow-ups, and reviews.
- **Subagent (`agents/codex-worker.md`)** — Background worker (`subagent: true`, `inheritMcp: true`) for parallel read-only tasks or strictly disjoint file-ownership slices.

---

## Example Prompts

- **Mode A (Architecture & Implementation):**
  - *"Design and implement rate limiting for our FastAPI endpoints with Codex — plan first, then build after I approve."*
  - *"让 Codex 先只读分析整个鉴权模块的重构方案，确认后再动手改代码。"*
- **On-Demand Subagent & Review:**
  - *"Have Codex review my uncommitted changes and summarize any concurrency or error-handling bugs."*
  - *"Ask Codex to inspect `scripts/worker.py` and explain why retries stall."*

---

## Development & Validation

Run the full test suite (runner unit/integration tests, stdio JSON-RPC MCP tests, and plugin bundle validation tests):

```bash
python3 -W error -m unittest discover -s tests -v
```

If Antigravity CLI is available in your environment, validate the plugin bundle strictly:

```bash
agy plugin validate --strict .
```

---

## License

MIT

---

## Workspace Metadata

- **所属 Agent**：Antigravity (Gemini)
- **目录性质**：持久化（长期保留）
- **创建日期**：2026-11-21
- **任务简述**：将 OpenAI Codex CLI 封装为面向 Antigravity 的开源原生插件（`codex-bridge`），结合 Gemini 的自然语言需求翻译能力与 Codex 的代码仓库设计、后端实现及审查能力，并可发布至 GitHub 与提报 Antigravity Marketplace。
