from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import unittest
import warnings
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from codex_runner import (  # noqa: E402
    CodexRunnerError,
    CodexTaskManager,
    check_auth_state,
    check_status,
    inspect_git_repo,
    parse_jsonl_output,
    resolve_codex_bin,
    validate_cwd,
    validate_sandbox,
)

FAKE_CODEX = str(REPO_ROOT / "tests" / "fake_codex.py")


class TestRunnerFoundation(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_validate_cwd_rejects_missing_dir(self) -> None:
        with self.assertRaises(CodexRunnerError):
            validate_cwd("/path/that/does/not/exist/codex-bridge-xyz")

    def test_validate_cwd_rejects_file_path(self) -> None:
        file_path = self.tmpdir / "not_a_dir.txt"
        file_path.write_text("hello", encoding="utf-8")
        with self.assertRaises(CodexRunnerError):
            validate_cwd(str(file_path))

    def test_validate_sandbox_blocks_danger_by_default(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("CODEX_BRIDGE_ALLOW_DANGER_SANDBOX", None)
            self.assertEqual(validate_sandbox("workspace-write"), "workspace-write")
            self.assertEqual(validate_sandbox("read-only"), "read-only")
            with self.assertRaises(CodexRunnerError):
                validate_sandbox("danger-full-access")

    def test_validate_sandbox_allows_danger_with_opt_in(self) -> None:
        with mock.patch.dict(os.environ, {"CODEX_BRIDGE_ALLOW_DANGER_SANDBOX": "1"}):
            self.assertEqual(validate_sandbox("danger-full-access"), "danger-full-access")

    def test_validate_sandbox_rejects_unknown_mode(self) -> None:
        with self.assertRaises(CodexRunnerError):
            validate_sandbox("arbitrary-mode")

    def test_resolve_codex_bin_uses_codex_bin_override(self) -> None:
        with mock.patch.dict(os.environ, {"CODEX_BIN": FAKE_CODEX}, clear=False):
            self.assertEqual(resolve_codex_bin(), FAKE_CODEX)
        with mock.patch.dict(os.environ, {"CODEX_BIN": "/nonexistent/codex-xyz"}, clear=False):
            self.assertIsNone(resolve_codex_bin())

    def test_check_status_detects_custom_provider_without_oauth_login(self) -> None:
        codex_home = self.tmpdir / "codex_home"
        codex_home.mkdir()
        (codex_home / "config.toml").write_text(
            '# custom setup\nmodel_provider = "custom"\nmodel = "gpt-6"\n\n[model_providers.custom]\nenv_key = "CUSTOM_KEY"\n',
            encoding="utf-8",
        )
        env = {
            "CODEX_BIN": FAKE_CODEX,
            "CODEX_HOME": str(codex_home),
            "FAKE_CODEX_LOGIN_STATUS": "Not logged in",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            os.environ.pop("OPENAI_API_KEY", None)
            res = check_status(cwd=str(self.tmpdir))

        self.assertTrue(res["binary_found"])
        self.assertFalse(res["oauth_logged_in"])
        self.assertTrue(res["custom_provider_configured"])
        self.assertEqual(res["model_provider"], "custom")
        self.assertTrue(res["auth_ready"])
        self.assertFalse(res["git"]["is_git_repo"])
        self.assertNotIn("sk-", json.dumps(res))

    def test_check_auth_state_never_leaks_api_key(self) -> None:
        codex_home = self.tmpdir / "empty_codex_home"
        codex_home.mkdir()
        secret = "sk-test-secret-do-not-leak-12345"
        env = {
            "CODEX_HOME": str(codex_home),
            "OPENAI_API_KEY": secret,
            "FAKE_CODEX_LOGIN_STATUS": "Not logged in",
        }
        with mock.patch.dict(os.environ, env, clear=False):
            auth = check_auth_state(FAKE_CODEX)

        self.assertTrue(auth["api_key_env_set"])
        self.assertTrue(auth["auth_ready"])
        self.assertFalse(auth["oauth_logged_in"])
        self.assertNotIn(secret, json.dumps(auth))
        self.assertNotIn("sk-", json.dumps(auth))

    def test_inspect_git_repo_reports_branch_and_dirty_state(self) -> None:
        repo = self.tmpdir / "repo"
        repo.mkdir()
        subprocess.run(["git", "init", "-b", "main"], cwd=repo, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=repo, check=True, capture_output=True)
        (repo / "tracked.txt").write_text("v1\n", encoding="utf-8")
        subprocess.run(["git", "add", "tracked.txt"], cwd=repo, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=repo, check=True, capture_output=True)

        clean_info = inspect_git_repo(repo)
        self.assertTrue(clean_info["is_git_repo"])
        self.assertEqual(clean_info["branch"], "main")
        self.assertFalse(clean_info["dirty"])
        self.assertEqual(clean_info["dirty_count"], 0)

        (repo / "tracked.txt").write_text("v2\n", encoding="utf-8")
        dirty_info = inspect_git_repo(repo)
        self.assertTrue(dirty_info["dirty"])
        self.assertEqual(dirty_info["dirty_count"], 1)

    def test_parse_jsonl_output_ignores_malformed_lines(self) -> None:
        raw = (
            '{"type":"thread.started","thread_id":"thr_123"}\n'
            "NOT_JSON\n"
            '{"type":"item.completed","item":{"type":"agent_message","text":"Plan ready"}}\n'
            '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'
        )
        parsed = parse_jsonl_output(raw)
        self.assertEqual(parsed["session_id"], "thr_123")
        self.assertEqual(parsed["usage"]["output_tokens"], 5)
        self.assertEqual(parsed["agent_text"], "Plan ready")
        self.assertEqual(parsed["events_count"], 3)

    def test_check_status_when_binary_missing_and_unauthenticated(self) -> None:
        codex_home = self.tmpdir / "empty_home"
        codex_home.mkdir()
        env = {
            "CODEX_BIN": "/nonexistent/codex-bin",
            "CODEX_HOME": str(codex_home),
        }
        with mock.patch.dict(os.environ, env, clear=False):
            os.environ.pop("OPENAI_API_KEY", None)
            res = check_status(cwd=str(self.tmpdir))

        self.assertFalse(res["binary_found"])
        self.assertIsNone(res["version"])
        self.assertFalse(res["auth_ready"])
        self.assertIsNotNone(res["remediation"])

    def test_parse_jsonl_output_extracts_errors_and_content_blocks(self) -> None:
        raw = (
            '{"type":"thread.started","thread_id":"thr_456"}\n'
            '{"type":"item.completed","item":{"type":"agent_message","content":[{"text":"Line 1"},{"text":"Line 2"}]}}\n'
            '{"type":"turn.failed","error":{"message":"sandbox denied"}}\n'
        )
        parsed = parse_jsonl_output(raw)
        self.assertEqual(parsed["session_id"], "thr_456")
        self.assertEqual(parsed["agent_text"], "Line 1\nLine 2")
        self.assertEqual(parsed["errors"], ["sandbox denied"])

    def test_fake_codex_executable_directly(self) -> None:
        proc = subprocess.run([FAKE_CODEX, "--version"], capture_output=True, text=True, check=False)
        self.assertEqual(proc.returncode, 0)
        self.assertIn("codex-cli", proc.stdout)


class TestCodexTaskManager(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmp.name)
        self.data_dir = self.tmpdir / "plugin_data"
        self.args_file = self.tmpdir / "fake_codex_args.jsonl"
        self.manager = CodexTaskManager(data_dir=self.data_dir)
        self._env_patch = mock.patch.dict(
            os.environ,
            {
                "CODEX_BIN": FAKE_CODEX,
                "FAKE_CODEX_ARGS_FILE": str(self.args_file),
            },
            clear=False,
        )
        self._env_patch.start()
        for key in (
            "CODEX_BRIDGE_ALLOW_DANGER_SANDBOX",
            "FAKE_CODEX_FAIL_MODE",
            "FAKE_CODEX_SLEEP",
            "FAKE_CODEX_WRITE_FILE",
            "FAKE_CODEX_WRITE_CONTENT",
            "FAKE_CODEX_EMPTY_OUTPUT",
            "FAKE_CODEX_SESSION_ID",
        ):
            os.environ.pop(key, None)

    def tearDown(self) -> None:
        try:
            if hasattr(self.manager, "shutdown"):
                self.manager.shutdown(terminate_running=True)
        finally:
            self._env_patch.stop()
            self._tmp.cleanup()

    def _init_git_repo(self, name: str = "repo") -> Path:
        repo = self.tmpdir / name
        repo.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "init", "-b", "main"], cwd=repo, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=repo, check=True, capture_output=True)
        (repo / "tracked.txt").write_text("initial\n", encoding="utf-8")
        subprocess.run(["git", "add", "tracked.txt"], cwd=repo, check=True, capture_output=True)
        subprocess.run(["git", "commit", "-m", "init"], cwd=repo, check=True, capture_output=True)
        return repo

    def _read_invocations(self) -> list[dict]:
        if not self.args_file.exists():
            return []
        lines = self.args_file.read_text(encoding="utf-8").splitlines()
        return [json.loads(line) for line in lines if line.strip()]

    def _flag_value(self, argv: list[str], *flags: str) -> str | None:
        for idx, token in enumerate(argv[:-1]):
            if token in flags:
                return argv[idx + 1]
        return None

    def test_run_plan_enforces_readonly_and_captures_session_id(self) -> None:
        plain_dir = self.tmpdir / "plain_project"
        plain_dir.mkdir()

        res = self.manager.run_plan(
            prompt="Design the API module",
            cwd=str(plain_dir),
            model="gpt-5.4",
            reasoning_effort="high",
            images=["diagram.png"],
        )

        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["sandbox"], "read-only")
        self.assertEqual(res["session_id"], "thr_fake_001")
        self.assertIn("Design the API module", res["summary"])
        self.assertEqual(res["usage"], {"input_tokens": 120, "output_tokens": 45})
        self.assertIsNone(res["error"])

        invocations = self._read_invocations()
        self.assertEqual(len(invocations), 1)
        argv = invocations[0]["argv"]
        self.assertEqual(argv[0], "exec")
        self.assertIn("--json", argv)
        self.assertIn("--skip-git-repo-check", argv)
        self.assertNotIn("--ephemeral", argv)
        self.assertEqual(self._flag_value(argv, "-s", "--sandbox"), "read-only")
        self.assertEqual(self._flag_value(argv, "-C", "--cd"), str(plain_dir.resolve()))
        self.assertIsNotNone(self._flag_value(argv, "-o", "--output-last-message"))
        self.assertEqual(self._flag_value(argv, "-m", "--model"), "gpt-5.4")
        self.assertEqual(self._flag_value(argv, "-i", "--image"), "diagram.png")
        self.assertIn('model_reasoning_effort="high"', argv)

        repo = self._init_git_repo("git_plan_repo")
        res_git = self.manager.run_plan(prompt="Inspect repo", cwd=str(repo))
        self.assertEqual(res_git["status"], "completed")
        git_argv = self._read_invocations()[1]["argv"]
        self.assertNotIn("--skip-git-repo-check", git_argv)

    def test_run_exec_fresh_and_git_diff_delta(self) -> None:
        repo = self._init_git_repo("diff_repo")
        (repo / "pre.txt").write_text("dirty before run\n", encoding="utf-8")

        with mock.patch.dict(
            os.environ,
            {
                "FAKE_CODEX_WRITE_FILE": "new.txt",
                "FAKE_CODEX_WRITE_CONTENT": "line 1\nline 2\n",
            },
        ):
            res = self.manager.run_exec(
                prompt="Create new.txt",
                cwd=str(repo),
            )

        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["sandbox"], "workspace-write")
        self.assertEqual(res["session_id"], "thr_fake_001")
        self.assertEqual(res["changed_files"], ["new.txt"])
        self.assertNotIn("pre.txt", res["changed_files"])
        self.assertEqual(res["pre_existing_dirty_files"], ["pre.txt"])
        self.assertTrue(res["diff_stat"])
        self.assertIn("new.txt", res["diff_stat"])
        self.assertNotIn("pre.txt", res["diff_stat"])

    def test_run_exec_tracks_tracked_modifications_without_blaming_preexisting(self) -> None:
        repo = self._init_git_repo("tracked_diff_repo")
        (repo / "pre.txt").write_text("preexisting untracked\n", encoding="utf-8")

        with mock.patch.dict(
            os.environ,
            {
                "FAKE_CODEX_WRITE_FILE": "tracked.txt",
                "FAKE_CODEX_WRITE_CONTENT": "initial\nadded line\n",
            },
        ):
            res = self.manager.run_exec(prompt="Update tracked.txt", cwd=str(repo))

        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["changed_files"], ["tracked.txt"])
        self.assertEqual(res["pre_existing_dirty_files"], ["pre.txt"])
        self.assertIn("tracked.txt", res["diff_stat"])
        self.assertNotIn("pre.txt", res["diff_stat"])

    def test_run_exec_detects_further_modification_to_preexisting_dirty_file(self) -> None:
        repo = self._init_git_repo("reedit_repo")
        (repo / "pre.txt").write_text("before\n", encoding="utf-8")

        with mock.patch.dict(
            os.environ,
            {
                "FAKE_CODEX_WRITE_FILE": "pre.txt",
                "FAKE_CODEX_WRITE_CONTENT": "modified during run\n",
            },
        ):
            res = self.manager.run_exec(prompt="Edit pre.txt", cwd=str(repo))

        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["changed_files"], ["pre.txt"])
        self.assertEqual(res["pre_existing_dirty_files"], [])

    def test_run_exec_resume_passes_sandbox_via_config_and_handles_failure(self) -> None:
        repo = self._init_git_repo("resume_repo")

        with mock.patch.dict(
            os.environ,
            {
                "FAKE_CODEX_WRITE_FILE": "resumed.txt",
                "FAKE_CODEX_WRITE_CONTENT": "implemented\n",
            },
        ):
            res = self.manager.run_exec(
                prompt="Implement approved plan",
                cwd=str(repo),
                session_id="thr_plan_789",
            )

        self.assertEqual(res["status"], "completed")
        self.assertEqual(res["session_id"], "thr_plan_789")
        self.assertFalse(res["resume_failed"])
        self.assertEqual(res["changed_files"], ["resumed.txt"])

        invocations = self._read_invocations()
        self.assertEqual(len(invocations), 1)
        argv = invocations[0]["argv"]
        self.assertEqual(argv[:3], ["exec", "resume", "thr_plan_789"])
        self.assertEqual(invocations[0]["cwd"], str(repo.resolve()))
        self.assertNotIn("-s", argv)
        self.assertNotIn("--sandbox", argv)
        self.assertNotIn("-C", argv)
        self.assertNotIn("--cd", argv)
        self.assertIn('sandbox_mode="workspace-write"', argv)

        with mock.patch.dict(os.environ, {"FAKE_CODEX_FAIL_MODE": "resume"}):
            failed = self.manager.run_exec(
                prompt="Continue plan",
                cwd=str(repo),
                session_id="thr_missing",
            )

        self.assertEqual(failed["status"], "failed")
        self.assertTrue(failed["resume_failed"])
        self.assertTrue(failed["error"])
        self.assertTrue(failed["hint"])
        self.assertIn("fresh", failed["hint"].lower())

    def test_run_exec_wait_timeout_transitions_to_poll_and_completes(self) -> None:
        repo = self._init_git_repo("poll_repo")

        with mock.patch.dict(
            os.environ,
            {
                "FAKE_CODEX_SLEEP": "0.6",
                "FAKE_CODEX_WRITE_FILE": "async_out.txt",
            },
        ):
            initial = self.manager.run_exec(
                prompt="Long background job",
                cwd=str(repo),
                wait_seconds=0,
            )

        self.assertEqual(initial["status"], "running")
        task_id = initial["task_id"]
        self.assertTrue(task_id)
        task_file = self.data_dir / "tasks" / f"{task_id}.json"
        self.assertTrue(task_file.is_file())
        persisted_start = json.loads(task_file.read_text(encoding="utf-8"))
        self.assertEqual(persisted_start["status"], "running")

        time.sleep(0.15)
        mid = self.manager.poll_task(task_id, wait_seconds=0)
        self.assertIn(mid["status"], ("running", "completed"))
        if mid["status"] == "running":
            self.assertGreaterEqual(mid["progress_events"], 1)

        final = self.manager.poll_task(task_id, wait_seconds=5)
        self.assertEqual(final["status"], "completed")
        self.assertEqual(final["task_id"], task_id)
        self.assertEqual(final["changed_files"], ["async_out.txt"])

        persisted_end = json.loads(task_file.read_text(encoding="utf-8"))
        self.assertEqual(persisted_end["status"], "completed")

        # Test explicit async_mode=True as well
        with mock.patch.dict(os.environ, {"FAKE_CODEX_SLEEP": "0.2"}):
            async_res = self.manager.run_exec(
                prompt="Async job",
                cwd=str(repo),
                async_mode=True,
                wait_seconds=30,
            )
            self.assertEqual(async_res["status"], "running")
            done = self.manager.poll_task(async_res["task_id"], wait_seconds=5)
            self.assertEqual(done["status"], "completed")

    def test_run_review_avoids_mutually_exclusive_prompt_with_target(self) -> None:
        repo = self._init_git_repo("review_repo")

        res_uncommitted = self.manager.run_review(cwd=str(repo), mode="uncommitted")
        self.assertEqual(res_uncommitted["status"], "completed")
        self.assertFalse(res_uncommitted["routed_via_exec"])

        res_target_prompt = self.manager.run_review(
            cwd=str(repo),
            mode="uncommitted",
            prompt="focus on auth",
        )
        self.assertEqual(res_target_prompt["status"], "completed")
        self.assertTrue(res_target_prompt["routed_via_exec"])
        self.assertIn("focus on auth", res_target_prompt["summary"])

        res_custom = self.manager.run_review(
            cwd=str(repo),
            mode="custom",
            prompt="audit error handling",
        )
        self.assertEqual(res_custom["status"], "completed")
        self.assertFalse(res_custom["routed_via_exec"])

        res_base = self.manager.run_review(
            cwd=str(repo),
            mode="base",
            base_branch="main",
            model="gpt-5.4",
        )
        self.assertEqual(res_base["status"], "completed")
        self.assertFalse(res_base["routed_via_exec"])

        res_commit = self.manager.run_review(
            cwd=str(repo),
            mode="commit",
            commit_sha="HEAD",
            title="Initial commit",
        )
        self.assertEqual(res_commit["status"], "completed")
        self.assertFalse(res_commit["routed_via_exec"])

        invocations = self._read_invocations()
        self.assertEqual(len(invocations), 5)

        argv_uncommitted = invocations[0]["argv"]
        self.assertEqual(argv_uncommitted[:2], ["exec", "review"])
        self.assertEqual(invocations[0]["cwd"], str(repo.resolve()))
        self.assertIn("--json", argv_uncommitted)
        self.assertIn("--uncommitted", argv_uncommitted)
        self.assertNotIn("-s", argv_uncommitted)
        self.assertNotIn("-C", argv_uncommitted)

        argv_fallback = invocations[1]["argv"]
        self.assertEqual(argv_fallback[0], "exec")
        self.assertNotEqual(argv_fallback[1], "review")
        self.assertEqual(self._flag_value(argv_fallback, "-s", "--sandbox"), "read-only")
        self.assertEqual(self._flag_value(argv_fallback, "-C", "--cd"), str(repo.resolve()))
        self.assertIn("focus on auth", argv_fallback[-1])
        self.assertIn("uncommitted", argv_fallback[-1].lower())

        argv_custom = invocations[2]["argv"]
        self.assertEqual(argv_custom[:2], ["exec", "review"])
        self.assertIn("audit error handling", argv_custom)
        self.assertNotIn("--uncommitted", argv_custom)
        self.assertNotIn("--base", argv_custom)
        self.assertNotIn("--commit", argv_custom)

        argv_base = invocations[3]["argv"]
        self.assertEqual(argv_base[:2], ["exec", "review"])
        self.assertEqual(self._flag_value(argv_base, "--base"), "main")
        self.assertEqual(self._flag_value(argv_base, "-m", "--model"), "gpt-5.4")

        argv_commit = invocations[4]["argv"]
        self.assertEqual(argv_commit[:2], ["exec", "review"])
        self.assertEqual(self._flag_value(argv_commit, "--commit"), "HEAD")
        self.assertEqual(self._flag_value(argv_commit, "--title"), "Initial commit")

    def test_run_exec_rejects_danger_sandbox_and_empty_output_falls_back(self) -> None:
        repo = self._init_git_repo("guard_repo")
        with self.assertRaises(CodexRunnerError):
            self.manager.run_exec(
                prompt="Run unsafe",
                cwd=str(repo),
                sandbox="danger-full-access",
            )
        with self.assertRaises(CodexRunnerError):
            self.manager.run_exec(
                prompt="Resume unsafe",
                cwd=str(repo),
                session_id="thr_123",
                sandbox="danger-full-access",
            )

        with mock.patch.dict(os.environ, {"FAKE_CODEX_EMPTY_OUTPUT": "1"}):
            res = self.manager.run_exec(prompt="Fallback text test", cwd=str(repo))
        self.assertEqual(res["status"], "completed")
        self.assertIn("Fallback text test", res["summary"])

    def test_run_review_validation_and_poll_persistence(self) -> None:
        repo = self._init_git_repo("val_repo")
        with self.assertRaises(CodexRunnerError):
            self.manager.run_review(cwd=str(repo), mode="base")
        with self.assertRaises(CodexRunnerError):
            self.manager.run_review(cwd=str(repo), mode="commit")
        with self.assertRaises(CodexRunnerError):
            self.manager.run_review(cwd=str(repo), mode="custom")
        with self.assertRaises(CodexRunnerError):
            self.manager.run_review(cwd=str(repo), mode="invalid")
        with self.assertRaises(CodexRunnerError):
            self.manager.run_review(cwd=str(repo), base_branch="main", commit_sha="HEAD")

        res = self.manager.run_plan(prompt="Check persistence", cwd=str(repo))
        new_manager = CodexTaskManager(data_dir=self.data_dir)
        polled = new_manager.poll_task(res["task_id"])
        self.assertEqual(polled["status"], "completed")
        self.assertEqual(polled["session_id"], res["session_id"])

        with self.assertRaises(CodexRunnerError):
            new_manager.poll_task("task_does_not_exist")
        with self.assertRaises(CodexRunnerError):
            new_manager.poll_task("../escape")

    def test_run_review_base_and_commit_with_prompt_route_via_exec(self) -> None:
        repo = self._init_git_repo("review_fallback_repo")
        res_base = self.manager.run_review(
            cwd=str(repo),
            mode="base",
            base_branch="main",
            prompt="check migrations",
        )
        self.assertEqual(res_base["status"], "completed")
        self.assertTrue(res_base["routed_via_exec"])
        self.assertEqual(res_base["review_mode"], "base")

        res_commit = self.manager.run_review(
            cwd=str(repo),
            mode="commit",
            commit_sha="HEAD",
            title="Hotfix",
            prompt="verify edge cases",
        )
        self.assertEqual(res_commit["status"], "completed")
        self.assertTrue(res_commit["routed_via_exec"])
        self.assertEqual(res_commit["review_mode"], "commit")

        invocations = self._read_invocations()
        self.assertEqual(len(invocations), 2)
        for inv, needle_a, needle_b in (
            (invocations[0]["argv"], "main", "check migrations"),
            (invocations[1]["argv"], "HEAD", "verify edge cases"),
        ):
            self.assertEqual(inv[0], "exec")
            self.assertNotEqual(inv[1], "review")
            self.assertEqual(self._flag_value(inv, "-s", "--sandbox"), "read-only")
            self.assertIn(needle_a, inv[-1])
            self.assertIn(needle_b, inv[-1])

    def test_run_exec_readonly_omits_diff_and_handles_missing_bin_and_failure(self) -> None:
        repo = self._init_git_repo("ro_fail_repo")
        with mock.patch.dict(os.environ, {"FAKE_CODEX_WRITE_FILE": "should_not_write.txt"}):
            ro_res = self.manager.run_exec(
                prompt="Inspect safely",
                cwd=str(repo),
                sandbox="read-only",
            )
        self.assertEqual(ro_res["status"], "completed")
        self.assertEqual(ro_res["sandbox"], "read-only")
        self.assertEqual(ro_res["changed_files"], [])
        self.assertIsNone(ro_res["diff_stat"])
        self.assertFalse((repo / "should_not_write.txt").exists())

        with mock.patch.dict(os.environ, {"FAKE_CODEX_FAIL_MODE": "exec"}):
            fail_res = self.manager.run_exec(prompt="Trigger fail", cwd=str(repo))
        self.assertEqual(fail_res["status"], "failed")
        self.assertFalse(fail_res["resume_failed"])
        self.assertIn("codex exec failed", fail_res["error"])

        with mock.patch.dict(os.environ, {"CODEX_BIN": "/nonexistent/codex-missing"}):
            with self.assertRaises(CodexRunnerError):
                self.manager.run_plan(prompt="No binary", cwd=str(repo))

    def test_poll_task_marks_orphaned_running_pid_as_failed(self) -> None:
        orphan_id = "task_orphan123"
        orphan_path = self.data_dir / "tasks" / f"{orphan_id}.json"
        orphan_path.parent.mkdir(parents=True, exist_ok=True)
        orphan_path.write_text(
            json.dumps({"status": "running", "task_id": orphan_id, "pid": 99999999}),
            encoding="utf-8",
        )
        res = self.manager.poll_task(orphan_id, wait_seconds=0)
        self.assertEqual(res["status"], "failed")
        self.assertIn("no longer running", res["error"])

    def test_no_resource_warnings_during_task_execution(self) -> None:
        repo = self._init_git_repo("warn_repo")
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always", ResourceWarning)
            res = self.manager.run_exec(prompt="Clean pipes", cwd=str(repo))
            self.assertEqual(res["status"], "completed")
        resource_warnings = [w for w in caught if issubclass(w.category, ResourceWarning)]
        self.assertEqual(resource_warnings, [])


if __name__ == "__main__":
    unittest.main()
