"""Cross-process lock directories and retryable atomic text replacement."""
from __future__ import annotations

import json
import os
import random
import shutil
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


def _pid_alive(pid: int) -> bool:
    if isinstance(pid, bool) or not isinstance(pid, int) or pid <= 0:
        return False
    if os.name != "nt":
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True
        except OSError:
            return False
    try:
        import ctypes
        from ctypes import wintypes

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        kernel32.OpenProcess.restype = wintypes.HANDLE
        kernel32.GetExitCodeProcess.argtypes = (wintypes.HANDLE, ctypes.POINTER(wintypes.DWORD))
        kernel32.GetExitCodeProcess.restype = wintypes.BOOL
        kernel32.CloseHandle.argtypes = (wintypes.HANDLE,)
        kernel32.CloseHandle.restype = wintypes.BOOL
        handle = kernel32.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() == 5
        try:
            code = ctypes.c_ulong()
            return bool(kernel32.GetExitCodeProcess(handle, ctypes.byref(code))) and code.value == 259
        finally:
            kernel32.CloseHandle(handle)
    except (AttributeError, OSError):
        return True


def _inspect_stale_lock(lock_dir: Path, stale_after: float) -> tuple[str, str | None] | None:
    """Return ('owner', token) or ('ownerless', None) if lock_dir is safe to reclaim, else None."""
    owner_path = lock_dir / "owner.json"
    now = time.time()
    try:
        owner = json.loads(owner_path.read_text(encoding="utf-8"))
        if isinstance(owner, dict) and "created_at" in owner and "pid" in owner and isinstance(owner.get("token"), str):
            old = (now - float(owner["created_at"])) > stale_after
            dead = not _pid_alive(int(owner["pid"]))
            if old and dead:
                return ("owner", owner["token"])
            return None
    except FileNotFoundError:
        pass
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        pass

    # Owner file is missing or unreadable/corrupt (e.g. process crashed right after mkdir).
    # Reclaim only after the lock directory itself has aged past stale_after.
    try:
        stat_info = lock_dir.stat()
        if (now - stat_info.st_mtime) > stale_after:
            return ("ownerless", None)
    except OSError:
        pass
    return None


def _try_reclaim_stale_lock(lock_dir: Path, stale_after: float, expected: tuple[str, str | None]) -> bool:
    """Coordinate stale-lock reclamation behind an atomic recovery lock to prevent TOCTOU races."""
    recover_dir = lock_dir.with_name(f"{lock_dir.name}.recover")
    acquired_recover = False
    try:
        recover_dir.mkdir()
        acquired_recover = True
    except FileExistsError:
        # Reclaim an abandoned recovery marker only if it is clearly ancient.
        try:
            if (time.time() - recover_dir.stat().st_mtime) > max(stale_after, 30.0):
                shutil.rmtree(recover_dir, ignore_errors=True)
        except OSError:
            pass
        return False
    except OSError:
        return False

    try:
        current = _inspect_stale_lock(lock_dir, stale_after)
        if current != expected:
            return False
        tombstone = lock_dir.with_name(f"{lock_dir.name}.stale-{uuid.uuid4().hex}")
        try:
            lock_dir.rename(tombstone)
            shutil.rmtree(tombstone, ignore_errors=True)
            return True
        except OSError:
            return False
    finally:
        if acquired_recover:
            shutil.rmtree(recover_dir, ignore_errors=True)


@contextmanager
def file_lock(target: str | Path, timeout: float = 10.0, stale_after: float = 300.0) -> Iterator[None]:
    target_path = Path(target)
    lock_dir = target_path.with_name(f".{target_path.name}.lock")
    deadline = time.monotonic() + timeout
    token = uuid.uuid4().hex
    lock_dir.parent.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            lock_dir.mkdir()
            (lock_dir / "owner.json").write_text(
                json.dumps({"pid": os.getpid(), "created_at": time.time(), "token": token}),
                encoding="utf-8",
            )
            break
        except FileExistsError:
            stale_info = _inspect_stale_lock(lock_dir, stale_after)
            if stale_info is not None and _try_reclaim_stale_lock(lock_dir, stale_after, stale_info):
                continue
            if time.monotonic() >= deadline:
                raise TimeoutError(f"Timed out waiting for file lock: {target_path}")
            time.sleep(min(0.05 + random.random() * 0.05, max(0, deadline - time.monotonic())))
        except OSError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.05)
    try:
        yield
    finally:
        try:
            owner = json.loads((lock_dir / "owner.json").read_text(encoding="utf-8"))
            if owner.get("token") == token:
                shutil.rmtree(lock_dir)
        except (OSError, ValueError, json.JSONDecodeError):
            pass


def atomic_write_text(target: str | Path, content: str, retries: int = 8) -> None:
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        temp.write_text(content, encoding="utf-8")
        for attempt in range(retries):
            try:
                os.replace(temp, path)
                return
            except PermissionError:
                if attempt + 1 == retries:
                    raise
                time.sleep(0.025 * (attempt + 1))
    finally:
        try:
            temp.unlink()
        except FileNotFoundError:
            pass
