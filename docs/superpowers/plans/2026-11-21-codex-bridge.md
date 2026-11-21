# Codex Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `codex-bridge`, a zero-dependency open-source Antigravity plugin that pairs Gemini's conversational requirement translation with OpenAI Codex CLI (`exec`, `exec resume`, `exec review`) as an on-demand subagent supporting both Mode A two-phase planning/execution and ad-hoc single-task delegation.

**Architecture:** A Python 3.9+ standard-library stdio JSON-RPC 2.0 MCP server (`scripts/codex_mcp_server.py`) backed by a CLI runner & task manager (`scripts/codex_runner.py`) exposes five tools (`codex_status`, `codex_plan`, `codex_run`, `codex_poll`, `codex_review`) wired through `mcp_config.json` (`${PLUGIN_ROOT}`, `${PLUGIN_DATA}`, `timeoutSeconds: 900`). Always-on `rules/AGENTS.md`, progressive skills (`skills/codex-architect/SKILL.md`, `skills/codex-subagent/SKILL.md`), and optional parallel subagent (`agents/codex-worker.md`) shape Gemini into a conversational translator and smart router.

**Tech Stack:** Python 3.9+ standard library only (`json`, `sys`, `os`, `subprocess`, `threading`, `tempfile`, `pathlib`, `shutil`, `uuid`, `time`, `unittest`), OpenAI Codex CLI (`0.171.0+`), Antigravity Plugin Schema v1 (`plugin.json`, `mcp_config.json`, `SKILL.md`, `AGENTS.md`).

**Spec:** `docs/superpowers/specs/2026-11-21-codex-bridge-design.md`

---

## Global Constraints

- **Plugin Identifiers:** `name: "codex-bridge"`, `displayName: "Codex Bridge"` (must not prefix with `Antigravity`/`Gemini`/`Claude`/`Cursor` or suffix with `Plugin`/`MCP`).
- **Runtime Floor:** Python `>= 3.9` standard library only; zero third-party PyPI or npm packages; no `uv` required.
- **Safety Boundaries:** `codex_plan` always runs with `-s read-only`. `codex_run` allows only `workspace-write` (default) and `read-only`; `danger-full-access` is rejected server-side unless `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX=1` is explicitly set.
- **No `worktree` in v1:** `--worktree` is omitted across all tools (and `codex exec resume --worktree` is rejected by Codex CLI at runtime). Parallel `codex-worker` execution uses read-only queries or disjoint file slices in `cwd`.
- **Verified Codex CLI Flags (`0.171.0-alpha.13`):**
  - `codex exec` accepts `-s`, `-C`, `-m`, `-c`, `--skip-git-repo-check`, `--json`, `-o`, `-i`.
  - `codex exec resume <session_id> <prompt>` does **not** accept `-s` or `-C` flags; pass subprocess `cwd=<cwd>` and `-c sandbox_mode="<sandbox>"`.
  - `codex exec review` accepts `--json`, `-o`, `--skip-git-repo-check`, and runs in subprocess `cwd=<cwd>`, **but `--uncommitted`, `--base`, and `--commit` are mutually exclusive with `[PROMPT]`**.
- **Marketplace Layout:** No `AGENTS.md` at repository root; plugin rules live at `rules/AGENTS.md`; `SKILL.md` frontmatter `name` matches parent directory name; `scripts/*.py` retain `0755` permissions; `PLUGIN_ROOT`/`PLUGIN_DATA` are not duplicated inside `mcp_config.json` `"env"`.

## Review Focus

1. **Custom provider auth without `codex login`:** `codex login status` reports `Not logged in` when a user uses `$CODEX_HOME/config.toml` (`model_provider` + custom provider) or `OPENAI_API_KEY`; `codex_status` must inspect both without leaking secrets and report accurate readiness (tested in Task 1).
2. **`codex exec resume` failure / missing session:** When resuming an expired/invalid `session_id` exits non-zero, `codex_run` must return `status: "failed"`, `resume_failed: true`, and an actionable hint rather than crashing or silently hiding stderr (tested in Task 2).
3. **`codex_review` target + custom `prompt` conflict:** Passing both `mode="uncommitted"` (or `base_branch` / `commit_sha`) AND custom `prompt` must route via `codex exec -s read-only` focused diff review instead of passing mutually exclusive flags to `codex exec review` (tested in Task 2).
4. **Foreground `wait_seconds` timeout transition & malformed JSONL resilience:** Exceeding `wait_seconds` transitions smoothly to `status: "running"` with a persisted `task_id` pollable via `codex_poll`, and partial/malformed JSONL lines or empty `-o` output fall back gracefully (tested in Task 2 & Task 3).
5. **Marketplace strict manifest & bundle invariants:** Verify banned name prefixes/suffixes, missing root `AGENTS.md`, matching `SKILL.md` names, valid `codex-worker.md` built-in tool allowlist, square `logo.svg`, and `0755` executable permissions on `scripts/*.py` (tested in Task 5).

---

## File Structure

- `scripts/codex_runner.py`: Binary resolution, `cwd`/sandbox validation, auth & Git preflight, Git status/diff snapshots, `codex exec` / `exec resume` / `exec review` command builders, JSONL parser, and `${PLUGIN_DATA}`-backed background `CodexTaskManager`.
- `scripts/codex_mcp_server.py`: Executable (`0755`) newline-delimited JSON-RPC 2.0 stdio MCP server exposing the 5 tools (`codex_status`, `codex_plan`, `codex_run`, `codex_poll`, `codex_review`) with thread-safe stdout locking.
- `rules/AGENTS.md`: Always-on translator identity, smart routing boundaries, brief standard, and verification/translation contract.
- `skills/codex-architect/SKILL.md`: Mode A two-phase workflow (`clarify -> codex_plan -> translate & confirm -> codex_run resume -> verify`).
- `skills/codex-subagent/SKILL.md`: Ad-hoc on-demand Codex dispatch, follow-up resume, and review workflow.
- `agents/codex-worker.md`: Optional parallel Antigravity background worker (`subagent: true`, `mainAgent: false`, `inheritMcp: true`).
- `plugin.json`: Antigravity v1 plugin manifest (`codex-bridge`).
- `mcp_config.json`: Stdio MCP server wiring (`python3`, `${PLUGIN_ROOT}`, `${PLUGIN_DATA}`, `timeoutSeconds: 900`, `eager` tool hints).
- `assets/logo.svg`: 1:1 square vector logo legible on light and dark themes.
- `README.md`: Installation, auth, workflow examples, and GitHub/Marketplace documentation (preserving workspace status block).
- `tests/fake_codex.py`: Configurable mock `codex` CLI executable driven via `CODEX_BIN` and `FAKE_CODEX_*` env vars.
- `tests/test_codex_runner.py`: Unit and integration tests for `codex_runner.py`.
- `tests/test_mcp_server.py`: End-to-end stdio JSON-RPC MCP protocol tests.
- `tests/test_plugin_bundle.py`: Structural, schema, permission, and frontmatter validation tests.

---

### Task 1: Runner Foundation — Mock CLI, Validation, Auth/Git Preflight, & JSONL Parsing

**Files:**
- Create: `tests/fake_codex.py`
- Create: `scripts/codex_runner.py`
- Create: `tests/test_codex_runner.py`

**Interfaces:**
- Produces in `scripts/codex_runner.py`:
  - `class CodexRunnerError(ValueError): ...`
  - `resolve_codex_bin() -> str | None`
  - `validate_cwd(cwd: str) -> Path`
  - `validate_sandbox(sandbox: str, allow_danger: bool | None = None) -> str`
  - `check_auth_state(codex_bin: str | None) -> dict`
  - `inspect_git_repo(cwd: Path) -> dict`
  - `check_status(cwd: str | None = None) -> dict`
  - `parse_jsonl_output(stdout_text: str) -> dict`

- [ ] **Step 1: Write `tests/fake_codex.py` and Task 1 failing tests in `tests/test_codex_runner.py`**

Create `tests/fake_codex.py` (`0755`) supporting `--version`, `login status` (controlled by `FAKE_CODEX_LOGIN_STATUS`), `exec`, `exec resume`, and `exec review` (simulating JSONL `thread.started`, `item.completed`, `turn.completed`, writing `-o <path>`, mutating a test file on `workspace-write`, sleeping when `FAKE_CODEX_SLEEP` is set, and failing when `FAKE_CODEX_FAIL_MODE` is set).

Write initial tests in `tests/test_codex_runner.py`:
```python
class TestRunnerFoundation(unittest.TestCase):
    def test_validate_cwd_rejects_missing_dir(self):
        with self.assertRaises(CodexRunnerError):
            validate_cwd("/path/that/does/not/exist/codex-bridge-xyz")

    def test_validate_sandbox_blocks_danger_by_default(self):
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("CODEX_BRIDGE_ALLOW_DANGER_SANDBOX", None)
            self.assertEqual(validate_sandbox("workspace-write"), "workspace-write")
            self.assertEqual(validate_sandbox("read-only"), "read-only")
            with self.assertRaises(CodexRunnerError):
                validate_sandbox("danger-full-access")

    def test_validate_sandbox_allows_danger_with_opt_in(self):
        with mock.patch.dict(os.environ, {"CODEX_BRIDGE_ALLOW_DANGER_SANDBOX": "1"}):
            self.assertEqual(validate_sandbox("danger-full-access"), "danger-full-access")

    def test_check_status_detects_custom_provider_without_oauth_login(self):
        # Temporary CODEX_HOME/config.toml defining model_provider = "custom" + model = "gpt-6"
        # FAKE_CODEX_LOGIN_STATUS="Not logged in"
        res = check_status(cwd=str(self.tmpdir))
        self.assertTrue(res["binary_found"])
        self.assertFalse(res["oauth_logged_in"])
        self.assertTrue(res["custom_provider_configured"])
        self.assertTrue(res["auth_ready"])
        self.assertNotIn("sk-", json.dumps(res))

    def test_parse_jsonl_output_ignores_malformed_lines(self):
        raw = '{"type":"thread.started","thread_id":"thr_123"}\nNOT_JSON\n{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
        parsed = parse_jsonl_output(raw)
        self.assertEqual(parsed["session_id"], "thr_123")
        self.assertEqual(parsed["usage"]["output_tokens"], 5)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_codex_runner -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'codex_runner'`

- [ ] **Step 3: Implement foundation functions in `scripts/codex_runner.py`**

Implement `CodexRunnerError`, `resolve_codex_bin()` (checks `CODEX_BIN`, `shutil.which("codex")`, `/opt/homebrew/bin/codex`, `/usr/local/bin/codex`), `validate_cwd()`, `validate_sandbox()`, `check_auth_state()` (runs `codex login status` with 5s timeout, checks `OPENAI_API_KEY` existence as boolean only, and parses `$CODEX_HOME/config.toml` / `~/.codex/config.toml` line-wise for non-comment `model_provider =` without reading or returning secrets), `inspect_git_repo()`, `check_status()`, and `parse_jsonl_output()` (extracts `thread_id`, `usage`, fallback agent text, and error messages, skipping non-JSON lines safely).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_codex_runner -v`
Expected: PASS (5 tests OK)

- [ ] **Step 5: Commit**

```bash
git add tests/fake_codex.py scripts/codex_runner.py tests/test_codex_runner.py
git commit -m "feat: add codex runner foundation, preflight checks, and mock CLI"
```

---

### Task 2: Runner Execution — `codex_plan`, `codex_run`, `codex_poll`, & `codex_review`

**Files:**
- Modify: `tests/fake_codex.py`
- Modify: `scripts/codex_runner.py`
- Modify: `tests/test_codex_runner.py`

**Interfaces:**
- Consumes: Task 1 helpers in `scripts/codex_runner.py`
- Produces in `scripts/codex_runner.py`:
  - `class CodexTaskManager:`
    - `__init__(self, data_dir: str | Path | None = None)`
    - `run_plan(self, prompt: str, cwd: str, model: str | None = None, reasoning_effort: str | None = None, images: list[str] | None = None, wait_seconds: int = 120) -> dict`
    - `run_exec(self, prompt: str, cwd: str, session_id: str | None = None, sandbox: str = "workspace-write", model: str | None = None, reasoning_effort: str | None = None, images: list[str] | None = None, async_mode: bool = False, wait_seconds: int = 120) -> dict`
    - `poll_task(self, task_id: str, wait_seconds: int = 30) -> dict`
    - `run_review(self, cwd: str, mode: str = "uncommitted", base_branch: str | None = None, commit_sha: str | None = None, title: str | None = None, prompt: str | None = None, model: str | None = None, wait_seconds: int = 120) -> dict`

- [ ] **Step 1: Add failing execution, resume, review, diff, and async polling tests to `tests/test_codex_runner.py`**

Add tests covering:
- `test_run_plan_enforces_readonly_and_captures_session_id`: verifies `fake_codex` received `-s read-only`, `-C <cwd>`, `--json`, `-o <tmp>` (and `--skip-git-repo-check` when outside git), returns `status == "completed"`, `sandbox == "read-only"`, `session_id`, and `summary`.
- `test_run_exec_fresh_and_git_diff_delta`: creates a git repo with one pre-existing dirty file `pre.txt`, has `fake_codex` modify/create `new.txt`, and verifies `changed_files` flags `new.txt` without falsely attributing `pre.txt` if unchanged, plus `diff_stat` is populated.
- `test_run_exec_resume_passes_sandbox_via_config_and_handles_failure`: verifies `codex exec resume <id>` omits `-s`/`-C`, sets `cwd`, passes `-c sandbox_mode="workspace-write"`, and when `FAKE_CODEX_FAIL_MODE="resume"` returns `status == "failed"`, `resume_failed == True`, and actionable hint.
- `test_run_exec_wait_timeout_transitions_to_poll_and_completes`: sets `FAKE_CODEX_SLEEP="0.6"` with `wait_seconds=0` (or `async_mode=True`), asserts initial `status == "running"` and persisted `task_id` file in `data_dir`, then `poll_task(task_id, wait_seconds=5)` returns `status == "completed"`.
- `test_run_review_avoids_mutually_exclusive_prompt_with_target`:
  - `run_review(cwd, mode="uncommitted")` invokes `codex exec review --json -o ... --uncommitted`.
  - `run_review(cwd, mode="uncommitted", prompt="focus on auth")` routes to `codex exec --json -s read-only -C <cwd> -o ...` containing `"focus on auth"` and target context instead of invalid `codex exec review --uncommitted <prompt>`.
  - `run_review(cwd, mode="custom", prompt="audit error handling")` invokes `codex exec review --json -o ... "audit error handling"`.

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `python3 -m unittest tests.test_codex_runner -v`
Expected: FAIL with `ImportError: cannot import name 'CodexTaskManager'`

- [ ] **Step 3: Implement `CodexTaskManager` in `scripts/codex_runner.py` (and update `tests/fake_codex.py` if needed)**

Key implementation details:
- Use `tempfile.TemporaryDirectory` per run for `-o <last_msg.md>` (cleaned up on completion).
- Capture pre-run `git status --porcelain` map `{path: line}` when `sandbox != "read-only"` and `is_git_repo`, then compute post-run delta + `git diff --stat` (showing newly modified/added files vs pre-existing dirty files).
- Spawn `subprocess.Popen(..., start_new_session=True)` with background reader thread draining stdout/stderr so pipes never deadlock, reading JSONL progress incrementally, persisting `{task_id}.json` in `data_dir/tasks/` on start and completion.
- Enforce `max(0, min(wait_seconds, 600))` foreground wait using `threading.Event.wait(...)`; if still running, return `{"status": "running", "task_id": ..., "elapsed_ms": ..., "progress_events": ...}`.
- On non-zero return for `resume`, set `"resume_failed": True` and clear `hint` recommending retry as fresh `codex_run` carrying the approved plan.
- Implement `run_review` routing cleanly for `uncommitted`, `base`, `commit`, `custom`, and combined target+prompt fallback to `codex exec -s read-only`.

- [ ] **Step 4: Run tests to verify all pass**

Run: `python3 -m unittest tests.test_codex_runner -v`
Expected: PASS (all runner tests OK)

- [ ] **Step 5: Commit**

```bash
git add tests/fake_codex.py scripts/codex_runner.py tests/test_codex_runner.py
git commit -m "feat: implement codex plan, exec/resume, async poll, and review runner"
```

---

### Task 3: Zero-Dependency Stdio MCP Server (`scripts/codex_mcp_server.py`)

**Files:**
- Create: `scripts/codex_mcp_server.py`
- Create: `tests/test_mcp_server.py`

**Interfaces:**
- Consumes: `CodexTaskManager`, `check_status`, `CodexRunnerError` from `scripts/codex_runner.py`
- Produces in `scripts/codex_mcp_server.py`:
  - `class McpServer:` (`handle_request(msg: dict) -> dict | None`, `serve_stdio() -> None`)
  - 5 MCP tools: `codex_status`, `codex_plan`, `codex_run`, `codex_poll`, `codex_review`
  - CLI args: `--data-dir <PATH>`

- [ ] **Step 1: Write failing end-to-end stdio JSON-RPC tests in `tests/test_mcp_server.py`**

Test by launching `python3 scripts/codex_mcp_server.py --data-dir <tmpdir>` as a real subprocess over `stdin`/`stdout` with `CODEX_BIN=tests/fake_codex.py`:
- `test_initialize_and_tools_list`: sends `initialize` (`protocolVersion: "2024-11-05"`), `notifications/initialized`, `ping`, and `tools/list`; asserts all 5 tools exist with required schemas, `codex_run` schema enum only exposes `["workspace-write", "read-only"]` when `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX` is unset, and `instructions` concisely explains translator/Mode A usage.
- `test_tools_call_plan_then_resume_run_and_review`: calls `codex_status` -> `codex_plan` -> `codex_run` (with `session_id`) -> `codex_review` over live stdio JSON-RPC; verifies valid MCP `content: [{"type": "text", "text": "..."}]` JSON payloads and `isError: false`.
- `test_tools_call_errors_return_structured_isError_true`: passes missing `cwd` or disallowed `danger-full-access` and verifies clean JSON-RPC response with `result.isError == True` (not process crash).

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m unittest tests.test_mcp_server -v`
Expected: FAIL (`scripts/codex_mcp_server.py` missing)

- [ ] **Step 3: Implement `scripts/codex_mcp_server.py` and set `chmod 0755`**

Implement clean newline-delimited JSON-RPC 2.0 stdio loop:
- `SERVER_INFO = {"name": "codex-bridge", "version": "0.1.0"}`
- Thread-safe `stdout` writer with `threading.Lock()`, logging only to `sys.stderr`.
- Tool schemas accurately matching `CodexTaskManager` methods (`codex_run` `sandbox` enum dynamically includes `"danger-full-access"` only when `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX == "1"`, and server-side `validate_sandbox` enforces the same guard).
- Parse `--data-dir` via `argparse` (defaulting to `~/.cache/codex-bridge` if omitted).
- Set executable mode (`chmod +x scripts/codex_mcp_server.py scripts/codex_runner.py`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m unittest tests.test_mcp_server -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/codex_mcp_server.py tests/test_mcp_server.py
git commit -m "feat: add zero-dependency stdio MCP server for Codex CLI"
```

---

### Task 4: Translator Brain — Rules, Skills, & Optional Parallel Subagent

**Files:**
- Create: `rules/AGENTS.md`
- Create: `skills/codex-architect/SKILL.md`
- Create: `skills/codex-subagent/SKILL.md`
- Create: `agents/codex-worker.md`

**Interfaces:**
- References MCP tools exposed by `mcp_config.json` (`codex_status`, `codex_plan`, `codex_run`, `codex_poll`, `codex_review`)

- [ ] **Step 1: Write `rules/AGENTS.md`**

Keep concise (< 6 KB, well under the 24 KB Antigravity rule cap, no YAML frontmatter). Clearly define:
- **Role Split**: Gemini is the user-facing conversational translator & verifier; Codex is the heavy engineering & requested subagent worker.
- **Smart Routing**:
  - Gemini handles directly: clarifying dialogue, small copy/doc/config edits, quick file reads/explanations.
  - Heavy tasks (architecture design, backend systems, cross-file refactors, tricky debugging) -> activate `codex-architect` (Mode A: clarify -> `codex_plan` read-only -> translate plan for user approval -> `codex_run` with `session_id` resume).
  - Explicit user delegation ("let Codex ...", "让 Codex ...") or targeted code reviews -> activate `codex-subagent` immediately (on-demand subagent, zero unnecessary ceremony).
- **Cross-Workspace Guard**: Ask the user before targeting a `cwd` outside the current active workspace.
- **Brief Translation Contract**: Never forward raw vague prompts; always translate into Goal, Target `cwd` & Key Files, Constraints, Acceptance/Verification Criteria.
- **Result Translation Contract**: Never dump raw JSON/logs; inspect changed files / sanity checks and report clearly in the user's language (what changed, why, verification evidence, remaining choices).

- [ ] **Step 2: Write `skills/codex-architect/SKILL.md` and `skills/codex-subagent/SKILL.md`**

- `skills/codex-architect/SKILL.md`: YAML frontmatter (`name: codex-architect`, third-person `description` triggering on heavy backend/architecture/multi-file design tasks), step-by-step Mode A workflow including `codex_status` fallback, conversational clarification, structured brief template, Phase 1 `codex_plan`, human translation & sign-off gate, Phase 2 `codex_run(session_id=...)` (plus fallback to fresh `codex_run` carrying approved plan if `resume_failed: true`), `codex_poll` loop if `status == "running"`, and post-run inspection.
- `skills/codex-subagent/SKILL.md`: YAML frontmatter (`name: codex-subagent`, `description` triggering when the user explicitly asks to invoke Codex, run a Codex code review, or continue a prior Codex task), fast-path routing between `codex_plan` (read-only questions/analysis), `codex_run` (ad-hoc bounded edits & follow-up `session_id` turns), `codex_review` (uncommitted/base/commit/custom review), and `codex_poll`.

- [ ] **Step 3: Write `agents/codex-worker.md`**

YAML frontmatter (`name: codex-worker`, `description`, `subagent: true`, `mainAgent: false`, `inheritMcp: true`, `model: flash`, `tools: [read_file, call_mcp_tool, send_message]`). Body instructs the worker on executing a bounded slice via Codex MCP tools (either read-only analysis or strictly bounded file slice) and reporting structured findings back via `send_message`. *(Note: verify exact tool names against live Antigravity runtime before finalizing.)*

- [ ] **Step 4: Inspect sizes and frontmatter manually**

Run: `wc -c rules/AGENTS.md skills/*/SKILL.md agents/codex-worker.md`
Expected: `rules/AGENTS.md` well under 24,000 bytes; all files readable and concise.

- [ ] **Step 5: Commit**

```bash
git add rules/AGENTS.md skills/codex-architect/SKILL.md skills/codex-subagent/SKILL.md agents/codex-worker.md
git commit -m "feat: add translator rules, architect/subagent skills, and worker agent"
```

---

### Task 5: Plugin Manifest, MCP Wiring, Logo, Bundle Validation Tests, & GitHub `README.md`

**Files:**
- Create: `plugin.json`
- Create: `mcp_config.json`
- Create: `assets/logo.svg`
- Create: `tests/test_plugin_bundle.py`
- Modify: `README.md`

- [ ] **Step 1: Write failing bundle & schema validation tests in `tests/test_plugin_bundle.py`**

Assert all Antigravity Marketplace & loader invariants:
- `plugin.json` parses cleanly, has `$schema`, `name == "codex-bridge"` (`^[a-z0-9]+(-[a-z0-9]+)*$`), `displayName == "Codex Bridge"`, neither `name` nor `displayName` starts with `antigravity`/`gemini`/`claude`/`cursor` or ends with `plugin`/`mcp`, `description` is 80–200 chars, `version` is semver, `logo` exists at `assets/logo.svg`, `suggestedPrompts` has `<= 3` non-empty strings, `author` and `license` exist.
- `mcp_config.json` defines `mcpServers.codex` using `${PLUGIN_ROOT}/scripts/codex_mcp_server.py` and `${PLUGIN_DATA}`, sets `timeoutSeconds == 900`, does NOT duplicate `PLUGIN_ROOT` or `PLUGIN_DATA` inside `env`, and sets `eager: true` on `codex_status`, `codex_plan`, `codex_run`, `codex_review`.
- Root directory does **not** contain `AGENTS.md` or `GEMINI.md` or `.mcp.json` or `mcp.json`.
- `rules/AGENTS.md` exists, is non-empty, `< 24000` bytes, and has no YAML frontmatter.
- Every `skills/<dir>/SKILL.md` has YAML frontmatter with `name == <dir>` and non-empty `description`.
- `agents/codex-worker.md` has `name`, `description`, `subagent: true`, `mainAgent: false`, `inheritMcp: true`, and valid non-empty `tools`.
- `scripts/codex_mcp_server.py` and `scripts/codex_runner.py` have executable permissions (`stat.S_IXUSR`).

- [ ] **Step 2: Run bundle test to verify it fails**

Run: `python3 -m unittest tests.test_plugin_bundle -v`
Expected: FAIL (`plugin.json` / `mcp_config.json` missing)

- [ ] **Step 3: Create `plugin.json`, `mcp_config.json`, `assets/logo.svg`, and polish `README.md`**

- `plugin.json`: valid Antigravity manifest matching all checks above (with clean placeholder `repository`/`homepage` notes for the user's GitHub URL).
- `mcp_config.json`:
  ```json
  {
    "mcpServers": {
      "codex": {
        "command": "python3",
        "args": ["${PLUGIN_ROOT}/scripts/codex_mcp_server.py", "--data-dir", "${PLUGIN_DATA}"],
        "timeoutSeconds": 900,
        "tools": {
          "codex_status": { "eager": true, "background": "off" },
          "codex_plan": { "eager": true },
          "codex_run": { "eager": true },
          "codex_review": { "eager": true },
          "codex_poll": { "eager": false }
        }
      }
    }
  }
  ```
- `assets/logo.svg`: clean 128x128 square SVG (`viewBox="0 0 128 128"`) with ~10% transparent padding and high-contrast dual-node bridge icon readable on both light and dark backgrounds.
- `README.md`: keep the `AgentsWorkSpace` header metadata cleanly at top/bottom, and add comprehensive user documentation (overview of Gemini-as-Translator + Codex-as-Worker, prerequisites, local install / GitHub install via `agy plugin install`, configuration env vars `CODEX_BIN` and `CODEX_BRIDGE_ALLOW_DANGER_SANDBOX`, example prompts, and troubleshooting).

- [ ] **Step 4: Run the complete test suite and verify live Antigravity discovery check**

Run: `python3 -m unittest discover -s tests -v`
Expected: All tests in `test_codex_runner.py`, `test_mcp_server.py`, and `test_plugin_bundle.py` PASS with 0 failures.

*(Optional local smoke verification step during execution: symlink or copy to `~/.gemini/config/plugins/codex-bridge`, query `GetAllPlugins` via local Antigravity LanguageServer RPC to confirm zero discovery errors and clean registration of the MCP server, rules, skills, and agent, and report exact findings.)*

- [ ] **Step 5: Commit**

```bash
git add plugin.json mcp_config.json assets/logo.svg tests/test_plugin_bundle.py README.md
git commit -m "feat: add plugin manifest, MCP wiring, SVG logo, docs, and bundle tests"
```
