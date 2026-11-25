from __future__ import annotations

import multiprocessing
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SCRIPTS_DIR = Path(__file__).resolve().parent.parent / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))
import file_lock as file_lock_mod  # noqa: E402
from file_lock import atomic_write_text, file_lock  # noqa: E402


def _write_locked(path: str, value: str) -> None:
    target = Path(path)
    with file_lock(target):
        current = target.read_text(encoding="utf-8") if target.exists() else ""
        atomic_write_text(target, current + value + "\n")


class FileLockTests(unittest.TestCase):
    def test_concurrent_processes_preserve_all_records(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "tasks.json"
            processes = [multiprocessing.Process(target=_write_locked, args=(str(target), str(i))) for i in range(8)]
            for process in processes:
                process.start()
            for process in processes:
                process.join(5)
                self.assertEqual(process.exitcode, 0)
            self.assertEqual(set(target.read_text(encoding="utf-8").splitlines()), {str(i) for i in range(8)})
            self.assertFalse(target.with_name(".tasks.json.lock").exists())

    def test_dead_owner_lock_is_recovered(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "settings.json"
            lock = target.with_name(".settings.json.lock")
            lock.mkdir()
            (lock / "owner.json").write_text('{"pid":99999999,"created_at":1,"token":"old"}', encoding="utf-8")
            with file_lock(target, stale_after=0.01, timeout=1):
                atomic_write_text(target, "{}\n")
            self.assertEqual(target.read_text(encoding="utf-8"), "{}\n")

    def test_abandoned_ownerless_lock_is_recovered_after_stale_after(self) -> None:
        import os

        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "settings.json"
            lock = target.with_name(".settings.json.lock")
            lock.mkdir()
            old_time = 1.0
            os.utime(lock, (old_time, old_time))
            with file_lock(target, stale_after=0.01, timeout=1):
                atomic_write_text(target, '{"ok":true}\n')
            self.assertEqual(target.read_text(encoding="utf-8"), '{"ok":true}\n')

    def test_stale_reclaim_refuses_to_evict_fresh_lock_on_token_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "settings.json"
            lock = target.with_name(".settings.json.lock")
            lock.mkdir()
            (lock / "owner.json").write_text(
                '{"pid":99999999,"created_at":1,"token":"fresh-token"}',
                encoding="utf-8",
            )
            reclaimed = file_lock_mod._try_reclaim_stale_lock(lock, 0.01, ("owner", "old-stale-token"))
            self.assertFalse(reclaimed)
            self.assertTrue(lock.exists())

    def test_atomic_write_cleans_up_temp_file_when_write_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "settings.json"
            original_write = Path.write_text

            def flaky_write(path_self: Path, *args, **kwargs):
                original_write(path_self, "partial", encoding="utf-8")
                raise OSError("disk full")

            with mock.patch.object(Path, "write_text", autospec=True, side_effect=flaky_write):
                with self.assertRaises(OSError):
                    atomic_write_text(target, '{"ok":true}\n')
            self.assertEqual(list(Path(temp).glob("*.tmp")), [])

    def test_windows_pid_alive_treats_access_denied_as_alive(self) -> None:
        with (
            mock.patch.object(file_lock_mod.os, "name", "nt"),
            mock.patch("ctypes.WinDLL", create=True) as win_dll,
            mock.patch("ctypes.get_last_error", create=True, return_value=5),
        ):
            win_dll.return_value.OpenProcess.return_value = 0
            self.assertTrue(file_lock_mod._pid_alive(4242))

        with (
            mock.patch.object(file_lock_mod.os, "name", "nt"),
            mock.patch("ctypes.WinDLL", create=True) as win_dll,
            mock.patch("ctypes.get_last_error", create=True, return_value=87),
        ):
            win_dll.return_value.OpenProcess.return_value = 0
            self.assertFalse(file_lock_mod._pid_alive(4242))
