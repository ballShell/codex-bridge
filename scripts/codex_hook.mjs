#!/usr/bin/env node
/** Antigravity 2.0 PreToolUse correlation hook. */
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock, atomicWriteText } from './file_lock.mjs';

function safeRealpath(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

const MAX_PENDING_AGE_SECONDS = 60;
const MAX_PENDING_ENTRIES = 200;
const VALID_TOOL_NAMES = new Set(['codex_plan', 'codex_run', 'codex_review']);
const VALID_SERVER_NAMES = new Set(['codex-bridge_codex', 'codex']);

function resolveDataDir(env = process.env) {
  const configured = (env.CODEX_BRIDGE_DATA_DIR || env.PLUGIN_DATA || '').trim();
  return configured ? resolve(configured) : join(env.USERPROFILE || env.HOME || homedir(), '.cache', 'codex-bridge');
}
function unwrapTool(name, args) {
  if (name === 'call_mcp_tool' || name === 'mcp_tool') {
    const server = args.ServerName || args.serverName;
    const tool = args.ToolName || args.toolName;
    if (!VALID_SERVER_NAMES.has(server) || !VALID_TOOL_NAMES.has(tool)) return null;
    let nested = args.Arguments ?? args.arguments;
    if (typeof nested === 'string') { try { nested = JSON.parse(nested); } catch { nested = {}; } }
    return { name: tool, args: nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : {} };
  }
  const tool = [...VALID_TOOL_NAMES].find((suffix) => name === suffix || name.endsWith(`_${suffix}`));
  return tool ? { name: tool, args } : null;
}
function envHome() { return process.env.USERPROFILE || process.env.HOME || homedir(); }
function extract(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.conversationId !== 'string' || !payload.conversationId.trim()) return null;
  const call = payload.toolCall;
  if (!call || typeof call.name !== 'string' || !call.args || typeof call.args !== 'object') return null;
  const tool = unwrapTool(call.name, call.args);
  if (!tool) return null;
  const args = tool.args;
  const mode = tool.name === 'codex_plan' ? 'plan' : tool.name === 'codex_review' ? 'review' : (typeof args.session_id === 'string' && args.session_id.trim() ? 'resume' : 'exec');
  let cwd = typeof args.cwd === 'string' && args.cwd.trim() ? resolve(args.cwd.replace(/^~(?=$|[\\/])/, envHome())) : null;
  if (!cwd && typeof payload.cwd === 'string' && payload.cwd.trim()) cwd = resolve(payload.cwd.replace(/^~(?=$|[\\/])/, envHome()));
  const prompt = args.prompt || args.title;
  let preview = null;
  if (typeof prompt === 'string') {
    const collapsed = prompt.trim().split(/\s+/).filter(Boolean).join(' ');
    if (collapsed) {
      preview = collapsed.length <= 120 ? collapsed : `${collapsed.slice(0, 119).trimEnd()}…`;
    }
  }
  return { conversation_id: payload.conversationId.trim(), mode, cwd, prompt_preview: preview };
}

export async function processHookInput(raw, dataDir = resolveDataDir()) {
  try {
    const payload = raw.trim() ? JSON.parse(raw) : null;
    const entry = extract(payload);
    if (entry) {
      mkdirSync(dataDir, { recursive: true });
      const file = join(dataDir, 'pending_calls.jsonl');
      await withFileLock(file, async () => {
        const now = Date.now() / 1000;
        let items = [];
        try {
          for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
            const stripped = line.trim();
            if (!stripped) continue;
            try {
              const item = JSON.parse(stripped);
              if (item && typeof item === 'object' && Number.isFinite(item.ts) && now - item.ts <= MAX_PENDING_AGE_SECONDS) {
                items.push(item);
              }
            } catch {
              // ignore malformed line while keeping valid entries
            }
          }
        } catch { items = []; }
        items.push({ ts: now, ...entry });
        if (items.length > MAX_PENDING_ENTRIES) items = items.slice(-MAX_PENDING_ENTRIES);
        await atomicWriteText(file, items.map((item) => JSON.stringify(item)).join('\n') + '\n');
      });
    }
  } catch (err) {
    if (!(err instanceof SyntaxError) && err instanceof Error) process.stderr.write(`[codex-bridge hook] ${err.message}\n`);
  }
  return { decision: 'allow' };
}

if (process.argv[1] && safeRealpath(process.argv[1]) === safeRealpath(fileURLToPath(import.meta.url))) {
  let raw = '';
  try { for await (const chunk of process.stdin) raw += chunk; } catch (err) { process.stderr.write(`[codex-bridge hook] ${err.message}\n`); }
  const result = await processHookInput(raw);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
