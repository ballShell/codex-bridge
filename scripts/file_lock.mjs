/** Cross-process lock directories and retryable atomic file replacement. */
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { dirname, basename, join } from 'node:path';

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

function inspectStaleLock(lockDir, staleAfterMs) {
  const nowSec = Date.now() / 1000;
  const staleAfterSec = staleAfterMs / 1000;
  try {
    const owner = JSON.parse(readFileSync(join(lockDir, 'owner.json'), 'utf8'));
    if (
      owner
      && typeof owner === 'object'
      && Number.isFinite(owner.created_at)
      && Number.isInteger(owner.pid)
      && typeof owner.token === 'string'
    ) {
      if (nowSec - owner.created_at > staleAfterSec && !pidAlive(owner.pid)) {
        return { kind: 'owner', token: owner.token };
      }
      return null;
    }
  } catch {
    // Fall through to abandoned ownerless lock-dir check.
  }

  try {
    const st = statSync(lockDir);
    if (Date.now() - st.mtimeMs > staleAfterMs) {
      return { kind: 'ownerless', token: null };
    }
  } catch {
    // Lock directory disappeared concurrently.
  }
  return null;
}

function tryReclaimStaleLock(lockDir, staleAfterMs, expected) {
  const recoverDir = `${lockDir}.recover`;
  let acquired = false;
  try {
    mkdirSync(recoverDir);
    acquired = true;
  } catch (err) {
    if (err?.code === 'EEXIST') {
      try {
        const st = statSync(recoverDir);
        if (Date.now() - st.mtimeMs > Math.max(staleAfterMs, 30_000)) {
          rmSync(recoverDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
    }
    return false;
  }

  try {
    const current = inspectStaleLock(lockDir, staleAfterMs);
    if (!current || current.kind !== expected.kind || current.token !== expected.token) {
      return false;
    }
    const tomb = `${lockDir}.stale-${randomUUID()}`;
    try {
      renameSync(lockDir, tomb);
      rmSync(tomb, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  } finally {
    if (acquired) {
      rmSync(recoverDir, { recursive: true, force: true });
    }
  }
}

export async function withFileLock(target, operation, { timeout = 10000, staleAfter = 300000 } = {}) {
  const dir = dirname(target);
  const lock = join(dir, `.${basename(target)}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + timeout;
  mkdirSync(dir, { recursive: true });
  while (true) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, created_at: Date.now() / 1000, token }), 'utf8');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const stale = inspectStaleLock(lock, staleAfter);
      if (stale && tryReclaimStaleLock(lock, staleAfter, stale)) {
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for file lock: ${target}`);
      await delay(50);
    }
  }
  try { return await operation(); }
  finally {
    try {
      const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
      if (owner.token === token) rmSync(lock, { recursive: true, force: true });
    } catch { /* best-effort release */ }
  }
}

export async function atomicWriteText(target, content, retries = 8) {
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try { renameSync(temp, target); return; }
      catch (err) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(err.code) || attempt + 1 >= retries) throw err;
        await delay(25 * (attempt + 1));
      }
    }
  } finally { rmSync(temp, { force: true }); }
}

export function withFileLockSync(target, operation, { timeout = 10000, staleAfter = 300000 } = {}) {
  const lock = join(dirname(target), `.${basename(target)}.lock`);
  const token = randomUUID();
  const deadline = Date.now() + timeout;
  mkdirSync(dirname(target), { recursive: true });
  while (true) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, created_at: Date.now() / 1000, token }), 'utf8');
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const stale = inspectStaleLock(lock, staleAfter);
      if (stale && tryReclaimStaleLock(lock, staleAfter, stale)) {
        continue;
      }
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for file lock: ${target}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try { return operation(); }
  finally {
    try {
      const owner = JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8'));
      if (owner.token === token) rmSync(lock, { recursive: true, force: true });
    } catch { /* best effort */ }
  }
}

export function atomicWriteTextSync(target, content, retries = 8) {
  const temp = `${target}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, content, 'utf8');
    for (let attempt = 0; ; attempt += 1) {
      try { renameSync(temp, target); return; }
      catch (err) {
        if (!['EPERM', 'EACCES', 'EBUSY'].includes(err.code) || attempt + 1 >= retries) throw err;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25 * (attempt + 1));
      }
    }
  } finally { rmSync(temp, { force: true }); }
}
