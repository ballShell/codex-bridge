#!/usr/bin/env python3
"""Foundation helpers for invoking and inspecting OpenAI Codex CLI."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

VALID_SANDBOXES = ("read-only", "workspace-write", "danger-full-access")
FALLBACK_CODEX_PATHS = ("/opt/homebrew/bin/codex", "/usr/local/bin/codex")
PREFLIGHT_TIMEOUT_SECONDS = 5


class CodexRunnerError(ValueError):
    """Raised when runner validation or preflight requirements fail."""


def resolve_codex_bin() -> str | None:
    """Resolve the Codex CLI executable path or return None if unavailable."""
    override = os.environ.get("CODEX_BIN", "").strip()
    if override:
        candidate = Path(override).expanduser()
        if os.path.sep in override or candidate.exists():
            if candidate.is_file() and os.access(candidate, os.X_OK):
                return str(candidate)
            return None
        return shutil.which(override)

    which_path = shutil.which("codex")
    if which_path:
        return which_path

    for fallback in FALLBACK_CODEX_PATHS:
        if os.path.isfile(fallback) and os.access(fallback, os.X_OK):
            return fallback

    return None


def validate_cwd(cwd: str) -> Path:
    """Validate that cwd exists and resolves to a directory."""
    if not isinstance(cwd, str) or not cwd.strip():
        raise CodexRunnerError("cwd must be a non-empty directory path.")

    path = Path(cwd).expanduser().resolve()
    if not path.exists():
        raise CodexRunnerError(f"cwd does not exist: {cwd}")
    if not path.is_dir():
        raise CodexRunnerError(f"cwd is not a directory: {cwd}")
    return path


def validate_sandbox(sandbox: str, allow_danger: bool | None = None) -> str:
    """Validate sandbox mode and enforce opt-in for danger-full-access."""
    if sandbox not in VALID_SANDBOXES:
        raise CodexRunnerError(
            f"Invalid sandbox mode {sandbox!r}; expected one of {', '.join(VALID_SANDBOXES)}."
        )

    if sandbox == "danger-full-access":
        opted_in = (
            allow_danger
            if allow_danger is not None
            else os.environ.get("CODEX_BRIDGE_ALLOW_DANGER_SANDBOX") == "1"
        )
        if not opted_in:
            raise CodexRunnerError(
                "Sandbox mode 'danger-full-access' is disabled by default. "
                "Set CODEX_BRIDGE_ALLOW_DANGER_SANDBOX=1 to allow unsandboxed execution."
            )

    return sandbox


def _strip_toml_inline_comment(raw_value: str) -> str:
    """Strip an unquoted TOML inline comment from a scalar value."""
    in_single = False
    in_double = False
    escaped = False
    for idx, ch in enumerate(raw_value):
        if escaped:
            escaped = False
            continue
        if ch == "\\" and in_double:
            escaped = True
            continue
        if ch == "'" and not in_double:
            in_single = not in_single
        elif ch == '"' and not in_single:
            in_double = not in_double
        elif ch == "#" and not in_single and not in_double:
            return raw_value[:idx].strip()
    return raw_value.strip()


def _detect_custom_provider() -> str | None:
    """Inspect $CODEX_HOME/config.toml (or ~/.codex/config.toml) for model_provider without reading secrets."""
    codex_home = os.environ.get("CODEX_HOME", "").strip()
    base_dir = Path(codex_home).expanduser() if codex_home else Path.home() / ".codex"
    config_path = base_dir / "config.toml"
    if not config_path.is_file():
        return None

    try:
        content = config_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    in_top_level = True
    for line in content.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("["):
            in_top_level = False
            continue
        if not in_top_level or "=" not in stripped:
            continue

        key, raw_val = stripped.split("=", 1)
        if key.strip() != "model_provider":
            continue

        val = _strip_toml_inline_comment(raw_val)
        if len(val) >= 2 and val[0] == val[-1] and val[0] in ('"', "'"):
            val = val[1:-1]
        val = val.strip()
        return val or None

    return None


def check_auth_state(codex_bin: str | None) -> dict[str, Any]:
    """Check Codex CLI authentication state without reading or leaking secret values."""
    oauth_logged_in = False
    login_status_text: str | None = None

    if codex_bin:
        try:
            proc = subprocess.run(
                [codex_bin, "login", "status"],
                capture_output=True,
                text=True,
                timeout=PREFLIGHT_TIMEOUT_SECONDS,
                check=False,
            )
            combined = "\n".join(
                part.strip() for part in (proc.stdout, proc.stderr) if part and part.strip()
            ).strip()
            if combined:
                login_status_text = combined.splitlines()[0].strip()
            oauth_logged_in = proc.returncode == 0 and "not logged in" not in combined.lower()
        except (subprocess.TimeoutExpired, OSError) as exc:
            login_status_text = f"login status check failed: {type(exc).__name__}"

    api_key_env_set = bool(os.environ.get("OPENAI_API_KEY", "").strip())
    model_provider = _detect_custom_provider()
    custom_provider_configured = bool(model_provider)
    auth_ready = bool(oauth_logged_in or api_key_env_set or custom_provider_configured)

    remediation = (
        None
        if auth_ready
        else (
            "Codex is not authenticated. Run `codex login`, set OPENAI_API_KEY, "
            "or configure `model_provider` in ~/.codex/config.toml."
        )
    )

    return {
        "oauth_logged_in": oauth_logged_in,
        "login_status_text": login_status_text,
        "api_key_env_set": api_key_env_set,
        "custom_provider_configured": custom_provider_configured,
        "model_provider": model_provider,
        "auth_ready": auth_ready,
        "remediation": remediation,
    }


def inspect_git_repo(cwd: Path) -> dict[str, Any]:
    """Inspect whether cwd is inside a Git work tree, its branch, and dirty count."""
    try:
        probe = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--is-inside-work-tree"],
            capture_output=True,
            text=True,
            timeout=PREFLIGHT_TIMEOUT_SECONDS,
            check=False,
        )
    except (subprocess.TimeoutExpired, OSError):
        return {"is_git_repo": False, "branch": None, "dirty": False, "dirty_count": 0}

    if probe.returncode != 0 or probe.stdout.strip().lower() != "true":
        return {"is_git_repo": False, "branch": None, "dirty": False, "dirty_count": 0}

    branch: str | None = None
    try:
        branch_proc = subprocess.run(
            ["git", "-C", str(cwd), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=PREFLIGHT_TIMEOUT_SECONDS,
            check=False,
        )
        if branch_proc.returncode == 0:
            branch = branch_proc.stdout.strip() or None
    except (subprocess.TimeoutExpired, OSError):
        branch = None

    dirty_count = 0
    try:
        status_proc = subprocess.run(
            ["git", "-C", str(cwd), "status", "--porcelain"],
            capture_output=True,
            text=True,
            timeout=PREFLIGHT_TIMEOUT_SECONDS,
            check=False,
        )
        if status_proc.returncode == 0:
            dirty_count = sum(1 for line in status_proc.stdout.splitlines() if line.strip())
    except (subprocess.TimeoutExpired, OSError):
        dirty_count = 0

    return {
        "is_git_repo": True,
        "branch": branch,
        "dirty": dirty_count > 0,
        "dirty_count": dirty_count,
    }


def check_status(cwd: str | None = None) -> dict[str, Any]:
    """Run preflight checks for Codex binary, version, auth readiness, and optional Git repo."""
    validated_cwd = validate_cwd(cwd) if cwd is not None else None
    codex_bin = resolve_codex_bin()
    binary_found = codex_bin is not None

    version: str | None = None
    if codex_bin:
        try:
            ver_proc = subprocess.run(
                [codex_bin, "--version"],
                capture_output=True,
                text=True,
                timeout=PREFLIGHT_TIMEOUT_SECONDS,
                check=False,
            )
            if ver_proc.returncode == 0:
                first_line = ver_proc.stdout.strip().splitlines()
                version = first_line[0].strip() if first_line else None
        except (subprocess.TimeoutExpired, OSError):
            version = None

    auth = check_auth_state(codex_bin)
    git_info = inspect_git_repo(validated_cwd) if validated_cwd is not None else None

    return {
        "binary_found": binary_found,
        "codex_bin": codex_bin,
        "version": version,
        "oauth_logged_in": auth["oauth_logged_in"],
        "login_status_text": auth["login_status_text"],
        "api_key_env_set": auth["api_key_env_set"],
        "custom_provider_configured": auth["custom_provider_configured"],
        "model_provider": auth["model_provider"],
        "auth_ready": auth["auth_ready"],
        "remediation": auth["remediation"],
        "auth": auth,
        "cwd": str(validated_cwd) if validated_cwd is not None else None,
        "git": git_info,
        "danger_sandbox_allowed": os.environ.get("CODEX_BRIDGE_ALLOW_DANGER_SANDBOX") == "1",
    }


def _extract_agent_item_text(item: dict[str, Any]) -> str:
    text = item.get("text")
    if isinstance(text, str) and text.strip():
        return text.strip()

    content = item.get("content")
    if isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if isinstance(block, dict):
                block_text = block.get("text")
                if isinstance(block_text, str) and block_text.strip():
                    parts.append(block_text.strip())
        if parts:
            return "\n".join(parts)
    return ""


def parse_jsonl_output(stdout_text: str) -> dict[str, Any]:
    """Parse newline-delimited JSON output from Codex CLI, ignoring malformed lines."""
    session_id: str | None = None
    usage: dict[str, Any] | None = None
    agent_messages: list[str] = []
    errors: list[str] = []
    events_count = 0

    for raw_line in stdout_text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue

        if not isinstance(event, dict):
            continue

        events_count += 1
        event_type = event.get("type")

        if event_type == "thread.started" and isinstance(event.get("thread_id"), str):
            session_id = event["thread_id"]
        elif session_id is None and isinstance(event.get("thread_id"), str):
            session_id = event["thread_id"]

        if event_type == "turn.completed" and isinstance(event.get("usage"), dict):
            usage = event["usage"]

        if event_type == "item.completed" and isinstance(event.get("item"), dict):
            item = event["item"]
            if item.get("type") == "agent_message":
                extracted = _extract_agent_item_text(item)
                if extracted:
                    agent_messages.append(extracted)

        if event_type in ("error", "turn.failed"):
            err_msg = event.get("message")
            if not isinstance(err_msg, str) and isinstance(event.get("error"), dict):
                err_msg = event["error"].get("message")
            if isinstance(err_msg, str) and err_msg.strip():
                errors.append(err_msg.strip())

    return {
        "session_id": session_id,
        "usage": usage,
        "agent_text": "\n\n".join(agent_messages).strip(),
        "errors": errors,
        "events_count": events_count,
    }
