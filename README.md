# Codex Bridge

**English** | [简体中文](README.zh-CN.md)

A **"front-of-house / back-of-house"** Antigravity 2.0 plugin that wraps OpenAI Codex CLI as a controllable subagent — complete with a live **Pixel-Dragon Codex Monitor** right inside Antigravity's side pane.

- **Front-of-House (Antigravity / Gemini):** Handles natural conversation, clarifies requirements, translates intent into structured engineering briefs, and verifies and summarizes outcomes in plain human language.
- **Back-of-House (Codex CLI):** Handles repository architecture, backend implementation, multi-file refactoring, and read-only code review — supporting both two-phase plan-then-build confirmation (`codex_plan` → `codex_run`) and on-demand invocation (`codex_review`, `codex_run`).
- **Live Codex Monitor:** Opens in Antigravity's auxiliary side pane, isolated per conversation (and its subagent tree), showing animated pixel-dragon workers, compact work statistics, model/effort/mode tags, live countdown timers, and sanitized error callouts.

## Meet the Pixel Dragon Crew

Every Codex worker appears as a 6-state animated pixel dragon reacting live to its execution stage:

| Idle | Thinking | Coding | Reviewing | Completed | Failed |
| :---: | :---: | :---: | :---: | :---: | :---: |
| ![Idle](sidecars/codex_monitor/assets/dragon/idle.gif) | ![Thinking](sidecars/codex_monitor/assets/dragon/thinking.gif) | ![Coding](sidecars/codex_monitor/assets/dragon/coding.gif) | ![Reviewing](sidecars/codex_monitor/assets/dragon/reviewing.gif) | ![Completed](sidecars/codex_monitor/assets/dragon/completed.gif) | ![Failed](sidecars/codex_monitor/assets/dragon/failed.gif) |
| Standing by | Planning & reasoning | Editing & running | Auditing diffs | Task finished | Error or timed out |

## What's New & Key Features

- **Plugin-Isolated Default Model Picker:** Choose any Codex-supported model directly from the **Codex Monitor** header dropdown. Selections persist in `${PLUGIN_DATA}/settings.json` without ever modifying your global `~/.codex/config.toml`, and you can switch back to *Follow Codex* at any time.
- **Soft Budget + Hard Watchdog Timeouts:** Every `codex_plan`, `codex_run`, and `codex_review` call supports `max_duration_seconds` (injecting an ~80% soft wrap-up directive plus a hard process-tree timeout watchdog) and optional `max_idle_seconds` stall detection, with live remaining-time countdowns in the monitor.
- **Structured Monitor UI & Error Sanitization:** Unified 2×2 work statistics (active/total tasks, token cache hit rate, average elapsed time, changed files & pass rate), expandable 4-column token breakdown, budget strip, and clean error callouts that strip raw HTML / reconnect noise while keeping the full raw log one click away.
- **Lazy MCP Tool Loading:** Only `codex_status` loads eagerly; `codex_plan`, `codex_run`, `codex_review`, and `codex_poll` stay lazy so tool schemas never bloat your main conversation context.
- **Cross-Process Lock & Safe Persistence:** Python and Node.js share an atomic lock-directory protocol (`scripts/file_lock.py` + `scripts/file_lock.mjs`) with stale-lock tombstone recovery and bounded-retry atomic replacement for `tasks.json`, `settings.json`, and `pending_calls.jsonl`.

## Platform & Environment Support

| Dimension | Supported Target | Status & Notes |
| :--- | :--- | :--- |
| **Host** | **Antigravity 2.0 Desktop** | Primary supported host (MCP server, `PreToolUse` hook, auxiliary pane sidecar, and `codex-worker` subagent). |
| **Runtime Prerequisites** | **Node.js 18+** & **Python 3.9+** | Zero third-party Python dependencies. Unified Node.js entrypoints (`launch_mcp.mjs`, `codex_hook.mjs`) boot both MCP and hooks consistently across OSes. |
| **macOS** | **Intel & Apple Silicon** | Verified end-to-end. Automatically discovers `codex` under GUI minimal `PATH` across Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`), `nvm`, `fnm`, `volta`, `mise`, `asdf`, `npm-global`, and `bun`. |
| **Windows** | **Windows 10/11 (cmd / PowerShell)** | Cross-platform support implemented & verified with automated unit tests *(real-machine Windows desktop smoke test recommended)*: avoids the Microsoft Store `python3.exe` alias via `launch_mcp.mjs` (`py -3` / real Python 3.9+ probe), resolves npm `.cmd`/`.bat` shims directly to `[node, <cli.js>]` without `cmd.exe` argument injection, forces UTF-8 stdio (CP936/GBK safe), cleans up descendant trees via `CREATE_NEW_PROCESS_GROUP` + `taskkill /T /F`, and retries atomic file replaces on Windows file locks. |
| **Codex CLI Auth** | `codex login` / API key / custom provider | Supports OAuth login, `OPENAI_API_KEY`, or custom `model_provider` & `model_catalog_json` in `$CODEX_HOME/config.toml`. |

## Installation

Install directly from GitHub via Antigravity CLI:

```bash
agy plugin install https://github.com/ballShell/codex-bridge
```

Or clone into your global Antigravity plugins directory:

```bash
git clone https://github.com/ballShell/codex-bridge.git ~/.gemini/config/plugins/codex-bridge
```

On Windows PowerShell:

```powershell
git clone https://github.com/ballShell/codex-bridge.git "$env:USERPROFILE\.gemini\config\plugins\codex-bridge"
```

## Configuration & Environment Variables

| Variable | Purpose |
| :--- | :--- |
| `CODEX_BIN` | Explicit path or command name for the `codex` CLI (takes highest precedence). |
| `CODEX_BRIDGE_PYTHON` | Explicit Python 3.9+ interpreter (or `py` launcher on Windows) used by `scripts/launch_mcp.mjs`. |
| `CODEX_BRIDGE_DEFAULT_MODEL` | Fallback plugin default model when no model is pinned in the Monitor UI (`${PLUGIN_DATA}/settings.json`). |
| `CODEX_BRIDGE_DATA_DIR` | Override the plugin state directory (`tasks/`, `settings.json`, `pending_calls.jsonl`). |
| `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX` | Set to `1` to opt in to `danger-full-access` (disabled by default). |
| `CODEX_HOME` | Override the Codex CLI home directory (defaults to `~/.codex` / `%USERPROFILE%\.codex`). |

## License

Licensed under the [MIT License](LICENSE).

---

<details>
<summary>Workspace Metadata (AgentsWorkSpace)</summary>

- **所属 Agent**：Antigravity (Gemini)
- **目录性质**：持久化（长期保留）
- **创建日期**：2026-11-21
- **任务简述**：将 OpenAI Codex CLI 封装为 Antigravity 原生插件（`codex-bridge`），实现前店后厂双模型协同。

</details>
