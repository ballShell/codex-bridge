import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { processHookInput } from '../scripts/codex_hook.mjs';

test('hook records the Antigravity MCP wrapper and always allows malformed input', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-hook-'));
  try {
    const payload = { conversationId: 'conv-1', toolCall: { name: 'call_mcp_tool', args: { ServerName: 'codex', ToolName: 'codex_plan', Arguments: JSON.stringify({ cwd: root, prompt: 'inspect this' }) } } };
    assert.deepEqual(await processHookInput(JSON.stringify(payload), root), { decision: 'allow' });
    const record = JSON.parse(readFileSync(join(root, 'pending_calls.jsonl'), 'utf8').trim());
    assert.equal(record.conversation_id, 'conv-1');
    assert.equal(record.mode, 'plan');
    assert.equal(record.prompt_preview, 'inspect this');
    assert.deepEqual(await processHookInput('{bad', root), { decision: 'allow' });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
