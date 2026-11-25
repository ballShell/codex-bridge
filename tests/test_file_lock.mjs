import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { withFileLock, atomicWriteText, withFileLockSync, atomicWriteTextSync } from '../scripts/file_lock.mjs';

test('Node lock serializes concurrent updates and releases the lock', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-lock-'));
  const file = join(root, 'pending_calls.jsonl');
  try {
    await Promise.all(Array.from({ length: 12 }, (_, i) => withFileLock(file, async () => {
      let entries = [];
      try { entries = readFileSync(file, 'utf8').trim().split('\n').filter(Boolean); } catch { /* first writer */ }
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 5));
      entries.push(String(i));
      await atomicWriteText(file, `${entries.join('\n')}\n`);
    })));
    assert.deepEqual(new Set(readFileSync(file, 'utf8').trim().split('\n')), new Set(Array.from({ length: 12 }, (_, i) => String(i))));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('sync lock safely reclaims an old dead-owner lock', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-stale-lock-'));
  const file = join(root, 'settings.json');
  const lock = join(root, '.settings.json.lock');
  try {
    mkdirSync(lock);
    writeFileSync(join(lock, 'owner.json'), JSON.stringify({ pid: 99999999, created_at: 1, token: 'stale' }));
    withFileLockSync(file, () => atomicWriteTextSync(file, '{}\n'), { staleAfter: 1 });
    assert.equal(readFileSync(file, 'utf8'), '{}\n');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('abandoned ownerless lock directory is reclaimed once stale', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-ownerless-lock-'));
  const file = join(root, 'pending_calls.jsonl');
  const lock = join(root, '.pending_calls.jsonl.lock');
  try {
    mkdirSync(lock);
    utimesSync(lock, new Date(1000), new Date(1000));
    await withFileLock(file, async () => {
      await atomicWriteText(file, '{"ok":true}\n');
    }, { staleAfter: 10, timeout: 1000 });
    assert.equal(readFileSync(file, 'utf8'), '{"ok":true}\n');
    assert.equal(readdirSync(root).filter((name) => name.endsWith('.tmp')).length, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
