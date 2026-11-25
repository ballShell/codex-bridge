#!/usr/bin/env python3
"""PreToolUse hook recording Antigravity conversationId correlation for Codex bridge tasks."""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from file_lock import atomic_write_text, file_lock

MAX_PENDING_AGE_SECONDS = 60.0
MAX_PENDING_ENTRIES = 200
VALID_TOOL_NAMES = ("codex_plan", "codex_run", "codex_review")
VALID_SERVER_NAMES = ("codex-bridge_codex", "codex")


def _make_prompt_preview(prompt: Any, max_len: int = 120) -> str | None:
    if not isinstance(prompt, str):
        return None
    collapsed = " ".join(prompt.split())
    if not collapsed:
        return None
    if len(collapsed) <= max_len:
        return collapsed
    return collapsed[: max_len - 1].rstrip() + "…"


def _normalize_cwd(raw_cwd: Any) -> str | None:
    if not isinstance(raw_cwd, str) or not raw_cwd.strip():
        return None
    try:
        return str(Path(raw_cwd).expanduser().resolve())
    except OSError:
        return raw_cwd.strip()


def _resolve_data_dir() -> Path:
    for env_key in ("CODEX_BRIDGE_DATA_DIR", "PLUGIN_DATA"):
        raw = os.environ.get(env_key, "").strip()
        if raw:
            return Path(raw).expanduser()
    return Path.home() / ".cache" / "codex-bridge"


def extract_codex_call(payload: dict[str, Any]) -> dict[str, Any] | None:
    """Extract {conversation_id, mode, cwd, prompt_preview} if payload is a Codex bridge task call."""
    conv_id = payload.get("conversationId")
    if not isinstance(conv_id, str) or not conv_id.strip():
        return None
    conv_id = conv_id.strip()

    tool_call = payload.get("toolCall")
    if not isinstance(tool_call, dict):
        return None

    tool_name = tool_call.get("name")
    raw_args = tool_call.get("args")
    if not isinstance(tool_name, str) or not isinstance(raw_args, dict):
        return None

    resolved_tool: str | None = None
    tool_args: dict[str, Any] = raw_args

    if tool_name in ("call_mcp_tool", "mcp_tool"):
        server_name = raw_args.get("ServerName") or raw_args.get("serverName")
        sub_tool = raw_args.get("ToolName") or raw_args.get("toolName")
        if server_name not in VALID_SERVER_NAMES or sub_tool not in VALID_TOOL_NAMES:
            return None
        resolved_tool = sub_tool
        sub_args = raw_args.get("Arguments") if "Arguments" in raw_args else raw_args.get("arguments")
        if isinstance(sub_args, str):
            try:
                parsed_sub = json.loads(sub_args)
            except json.JSONDecodeError:
                parsed_sub = {}
            tool_args = parsed_sub if isinstance(parsed_sub, dict) else {}
        elif isinstance(sub_args, dict):
            tool_args = sub_args
        else:
            tool_args = {}
    else:
        for suffix in VALID_TOOL_NAMES:
            if tool_name == suffix or tool_name.endswith("_" + suffix):
                resolved_tool = suffix
                break
        if resolved_tool is None:
            return None

    if resolved_tool == "codex_plan":
        mode = "plan"
    elif resolved_tool == "codex_review":
        mode = "review"
    else:
        sid = tool_args.get("session_id")
        mode = "resume" if isinstance(sid, str) and sid.strip() else "exec"

    norm_cwd = _normalize_cwd(tool_args.get("cwd"))
    if not norm_cwd:
        norm_cwd = _normalize_cwd(payload.get("cwd"))

    preview = _make_prompt_preview(tool_args.get("prompt") or tool_args.get("title"))
    return {
        "conversation_id": conv_id,
        "mode": mode,
        "cwd": norm_cwd,
        "prompt_preview": preview,
    }


def record_pending_call(entry: dict[str, Any], data_dir: Path | None = None, now: float | None = None) -> Path:
    """Append a fresh correlation entry to pending_calls.jsonl, pruning expired records."""
    target_dir = data_dir if data_dir is not None else _resolve_data_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    pending_path = target_dir / "pending_calls.jsonl"
    ts_now = now if now is not None else time.time()

    with file_lock(pending_path):
        fresh_entries: list[dict[str, Any]] = []
        if pending_path.is_file():
            try:
                for line in pending_path.read_text(encoding="utf-8", errors="replace").splitlines():
                    try:
                        item = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if isinstance(item, dict) and isinstance(item.get("ts"), (int, float)):
                        if (ts_now - float(item["ts"])) <= MAX_PENDING_AGE_SECONDS:
                            fresh_entries.append(item)
            except OSError:
                fresh_entries = []
        record = {
            "ts": ts_now,
            "conversation_id": entry["conversation_id"],
            "mode": entry["mode"],
            "cwd": entry.get("cwd"),
            "prompt_preview": entry.get("prompt_preview"),
        }
        fresh_entries.append(record)
        if len(fresh_entries) > MAX_PENDING_ENTRIES:
            fresh_entries = fresh_entries[-MAX_PENDING_ENTRIES:]
        content = "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in fresh_entries)
        atomic_write_text(pending_path, content)
    return pending_path


def process_hook_input(raw_text: str, data_dir: Path | None = None) -> dict[str, str]:
    """Fail-open hook processor: always returns {'decision': 'allow'} without overwrite."""
    try:
        payload = json.loads(raw_text) if raw_text.strip() else None
        if isinstance(payload, dict):
            extracted = extract_codex_call(payload)
            if extracted is not None:
                record_pending_call(extracted, data_dir=data_dir)
    except Exception:
        pass
    return {"decision": "allow"}


def main() -> int:
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            reconfigure(encoding="utf-8", errors="replace")
    try:
        raw_text = sys.stdin.read()
    except Exception:
        raw_text = ""
    result = process_hook_input(raw_text)
    sys.stdout.write(json.dumps(result) + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    sys.exit(main())
