import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePython } from '../scripts/launch_mcp.mjs';

test('Python resolver rejects an explicit interpreter older than 3.9', () => {
  assert.equal(resolvePython({ CODEX_BRIDGE_PYTHON: process.execPath }), null);
});

test('Python resolver finds Python from PATH candidates and skips WindowsApps alias', () => {
  const found = resolvePython({ PATH: process.env.PATH || '' });
  assert.ok(found);
  assert.equal(typeof found.command, 'string');
  assert.equal(
    resolvePython({ CODEX_BRIDGE_PYTHON: 'C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps\\python3.exe' }, 'win32'),
    null
  );
  assert.equal(
    resolvePython({ CODEX_BRIDGE_PYTHON: 'C:/Users/demo/AppData/Local/Microsoft/WindowsApps/python3.exe' }, 'win32'),
    null
  );
});
