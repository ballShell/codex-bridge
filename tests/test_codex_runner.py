from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from codex_runner import (  # noqa: E402
    CodexRunnerError,
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


if __name__ == "__main__":
    unittest.main()
