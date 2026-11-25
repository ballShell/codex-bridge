/**
 * Zero-dependency store backing the Codex Monitor sidecar.
 * Resolves Antigravity conversation trees, reads codex-bridge task state,
 * hydrates live running token usage when available, and computes aggregate stats.
 */

import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants as fsConstants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

export const SAFE_ID_RE = /^[A-Za-z0-9_-]{8,}$/;
export const SAFE_MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;
const SETTINGS_FILENAME = 'settings.json';
const UUID_CAPTURE = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CONV_JSON_RE = new RegExp(`(?:\\\\)?"conversationId(?:\\\\)?"\\s*:\\s*(?:\\\\)?"(${UUID_CAPTURE})(?:\\\\)?"`, 'gi');
const BRAIN_URI_RE = new RegExp(`brain/(${UUID_CAPTURE})/\\.system_generated/logs/`, 'gi');
const TASK_ID_RE = /\btask_[0-9a-f]{12}\b/g;

const CLI_STATUS_TTL_MS = 30_000;
const PREFLIGHT_TIMEOUT_MS = 5_000;
const MAX_CLI_SESSION_FILES = 25;
const MAX_SUBAGENT_DEPTH = 3;
const FALLBACK_CODEX_BINS = ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'];

export function resolvePaths(env = process.env) {
  let appDataDir = '';
  const execDataDir = (env.ANTIGRAVITY_EXECUTABLE_DATA_DIR || '').trim();
  if (execDataDir) {
    let cur = execDataDir;
    while (cur && cur !== dirname(cur)) {
      if (basename(cur) === 'sidecar_data') {
        appDataDir = dirname(cur);
        break;
      }
      cur = dirname(cur);
    }
  }
  if (!appDataDir) {
    const geminiDir = (env.ANTIGRAVITY_GEMINI_DIR || '').trim() || join(homedir(), '.gemini');
    appDataDir = join(geminiDir, 'antigravity');
  }

  const brainDir = (env.CODEX_BRIDGE_BRAIN_DIR || '').trim() || join(appDataDir, 'brain');
  const pluginDataDir =
    (env.CODEX_BRIDGE_DATA_DIR || '').trim() || join(appDataDir, 'plugin_data', 'codex-bridge');
  const tasksDir = join(pluginDataDir, 'tasks');
  const codexHomeDir = (env.CODEX_HOME || '').trim() || join(homedir(), '.codex');

  return { appDataDir, brainDir, pluginDataDir, tasksDir, codexHomeDir };
}

function stripTomlInlineComment(rawVal) {
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < rawVal.length; i += 1) {
    const ch = rawVal[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && inDouble) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === '#' && !inSingle && !inDouble) {
      return rawVal.slice(0, i).trim();
    }
  }
  return rawVal.trim();
}

function unquoteTomlString(rawVal) {
  let val = stripTomlInlineComment(rawVal);
  if (val.length >= 2 && val[0] === val[val.length - 1] && (val[0] === '"' || val[0] === "'")) {
    val = val.slice(1, -1);
  }
  const cleaned = val.trim();
  return cleaned || null;
}

export function readCodexDefaults(codexHomeDir) {
  const defaults = {
    model: null,
    model_reasoning_effort: null,
    model_provider: null,
    model_catalog_json: null,
  };
  const cfgPath = join(codexHomeDir, 'config.toml');
  if (!existsSync(cfgPath)) return defaults;

  let content = '';
  try {
    content = readFileSync(cfgPath, 'utf8');
  } catch {
    return defaults;
  }

  let inTopLevel = true;
  for (const line of content.split(/\r?\n/)) {
    const stripped = line.trim();
    if (!stripped || stripped.startsWith('#')) continue;
    if (stripped.startsWith('[')) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel || !stripped.includes('=')) continue;
    const eqIdx = stripped.indexOf('=');
    const key = stripped.slice(0, eqIdx).trim();
    if (Object.hasOwn(defaults, key)) {
      defaults[key] = unquoteTomlString(stripped.slice(eqIdx + 1));
    }
  }
  return defaults;
}

export function sanitizeModelId(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim();
  if (!cleaned || !SAFE_MODEL_RE.test(cleaned)) return null;
  return cleaned;
}

export function parseSettingsDefaultModel(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    const err = new Error('default_model must be a string or null.');
    err.statusCode = 400;
    throw err;
  }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const cleaned = sanitizeModelId(trimmed);
  if (!cleaned) {
    const err = new Error('Invalid default_model identifier.');
    err.statusCode = 400;
    throw err;
  }
  return cleaned;
}

export function readPluginSettings(pluginDataDir, env = process.env) {
  const settingsPath = join(pluginDataDir, SETTINGS_FILENAME);
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const configured = sanitizeModelId(parsed.default_model);
        if (configured) {
          return {
            default_model: configured,
            source: 'plugin',
          };
        }
      }
    } catch {
      // ignore malformed settings file
    }
  }

  const envModel = sanitizeModelId(env?.CODEX_BRIDGE_DEFAULT_MODEL || '');
  if (envModel) {
    return {
      default_model: envModel,
      source: 'env',
    };
  }
  return {
    default_model: null,
    source: 'codex',
  };
}

export function writePluginSettings(pluginDataDir, { default_model = null } = {}) {
  let cleanModel = null;
  if (default_model !== null && default_model !== undefined && default_model !== '') {
    cleanModel = sanitizeModelId(default_model);
    if (!cleanModel) {
      throw new Error('Invalid default_model identifier.');
    }
  }

  mkdirSync(pluginDataDir, { recursive: true });
  const settingsPath = join(pluginDataDir, SETTINGS_FILENAME);
  const tmpPath = join(pluginDataDir, `.${SETTINGS_FILENAME}.${randomUUID().slice(0, 8)}.tmp`);
  const payload = {
    default_model: cleanModel,
    updated_at: Date.now() / 1000,
  };
  writeFileSync(tmpPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  renameSync(tmpPath, settingsPath);
  return {
    default_model: cleanModel,
    source: cleanModel ? 'plugin' : 'codex',
  };
}

function resolveCatalogPath(codexHomeDir, rawCatalogPath) {
  if (!rawCatalogPath || typeof rawCatalogPath !== 'string') return null;
  const trimmed = rawCatalogPath.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return join(homedir(), trimmed.slice(2));
  }
  return isAbsolute(trimmed) ? trimmed : join(codexHomeDir, trimmed);
}

export function readAvailableCodexModels(codexHomeDir, defaults = null, pluginDefaultModel = null) {
  const cfg = defaults || readCodexDefaults(codexHomeDir);
  const candidates = [];
  const configuredCatalog = resolveCatalogPath(codexHomeDir, cfg?.model_catalog_json);
  if (configuredCatalog) candidates.push(configuredCatalog);
  candidates.push(join(codexHomeDir, 'models_cache.json'));

  const seen = new Set();
  const models = [];

  const pushModel = (id, label) => {
    const cleanId = sanitizeModelId(id);
    if (!cleanId || seen.has(cleanId)) return;
    seen.add(cleanId);
    const cleanLabel = typeof label === 'string' && label.trim() ? label.trim() : cleanId;
    models.push({ id: cleanId, label: cleanLabel });
  };

  for (const catalogPath of candidates) {
    if (!catalogPath || !existsSync(catalogPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(catalogPath, 'utf8'));
      const entries = Array.isArray(parsed?.models)
        ? parsed.models
        : Array.isArray(parsed)
          ? parsed
          : [];
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object') continue;
        if (entry.visibility === 'hide') continue;
        const slug = entry.slug || entry.id || entry.name;
        const displayName = entry.display_name || slug;
        pushModel(slug, displayName);
      }
      if (models.length > 0) break;
    } catch {
      // ignore invalid catalog JSON and try fallback
    }
  }

  pushModel(cfg?.model, cfg?.model);
  pushModel(pluginDefaultModel, pluginDefaultModel);
  return models;
}

function isExecutable(filePath) {
  try {
    const st = statSync(filePath);
    if (!st.isFile()) return false;
    accessSync(filePath, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveCodexBin(env = process.env) {
  const override = (env.CODEX_BIN || '').trim();
  if (override) {
    if (override.includes('/') || override.includes('\\') || existsSync(override)) {
      return isExecutable(override) ? override : null;
    }
    const pathDirs = (env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
    for (const dir of pathDirs) {
      if (!dir) continue;
      const cand = join(dir, override);
      if (isExecutable(cand)) return cand;
    }
    return null;
  }

  const pathDirs = (env.PATH || '').split(process.platform === 'win32' ? ';' : ':');
  const binName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  for (const dir of pathDirs) {
    if (!dir) continue;
    const cand = join(dir, binName);
    if (isExecutable(cand)) return cand;
  }

  for (const fallback of FALLBACK_CODEX_BINS) {
    if (isExecutable(fallback)) return fallback;
  }
  return null;
}

function execCommand(cmd, args, timeoutMs = PREFLIGHT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err && typeof err.code === 'number' ? err.code : err ? 1 : 0,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
          errName: err?.name || null,
        });
      }
    );
  });
}

function nonnegInt(val) {
  if (typeof val !== 'number' || !Number.isInteger(val) || val < 0) return null;
  return val;
}

export function normalizeUsage(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const inputTokens = nonnegInt(raw.input_tokens);
  const cachedTokens = nonnegInt(raw.cached_input_tokens);
  const outputTokens = nonnegInt(raw.output_tokens);
  const reasonTokens = nonnegInt(raw.reasoning_output_tokens);
  const totalRaw = nonnegInt(raw.total_tokens);
  if (
    inputTokens === null &&
    cachedTokens === null &&
    outputTokens === null &&
    reasonTokens === null &&
    totalRaw === null
  ) {
    return null;
  }
  const iTok = inputTokens ?? 0;
  const oTok = outputTokens ?? 0;
  return {
    input_tokens: iTok,
    cached_input_tokens: cachedTokens ?? 0,
    output_tokens: oTok,
    reasoning_output_tokens: reasonTokens ?? 0,
    total_tokens: totalRaw ?? iTok + oTok,
  };
}

function isPidAlive(pid) {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

export function createMonitorStore(env = process.env) {
  const transcriptCache = new Map();
  const rolloutCache = new Map();
  let cliStatusCache = null;

  async function getCachedCliStatus() {
    const paths = resolvePaths(env);
    const cacheKey = `${(env.CODEX_BIN || '').trim()}|${paths.codexHomeDir}|${(env.OPENAI_API_KEY || '').trim() ? '1' : '0'}`;
    const now = Date.now();
    if (cliStatusCache && cliStatusCache.key === cacheKey && now - cliStatusCache.at < CLI_STATUS_TTL_MS) {
      return { ...cliStatusCache.val };
    }

    const codexBin = resolveCodexBin(env);
    const binaryFound = codexBin !== null;
    const defaults = readCodexDefaults(paths.codexHomeDir);

    let version = null;
    let oauthLoggedIn = false;
    let loginStatusText = null;

    if (codexBin) {
      const [verRes, loginRes] = await Promise.all([
        execCommand(codexBin, ['--version']),
        execCommand(codexBin, ['login', 'status']),
      ]);
      if (verRes.ok && verRes.stdout.trim()) {
        version = verRes.stdout.trim().split(/\r?\n/)[0].trim();
      }
      const combined = [loginRes.stdout.trim(), loginRes.stderr.trim()].filter(Boolean).join('\n').trim();
      if (combined) {
        loginStatusText = combined.split(/\r?\n/)[0].trim();
      }
      oauthLoggedIn = loginRes.code === 0 && !combined.toLowerCase().includes('not logged in');
    }

    const apiKeyEnvSet = Boolean((env.OPENAI_API_KEY || '').trim());
    const customProviderConfigured = Boolean(defaults.model_provider);
    const authReady = Boolean(oauthLoggedIn || apiKeyEnvSet || customProviderConfigured);

    const status = {
      binary_found: binaryFound,
      codex_bin: codexBin,
      version,
      oauth_logged_in: oauthLoggedIn,
      login_status_text: loginStatusText,
      api_key_env_set: apiKeyEnvSet,
      custom_provider_configured: customProviderConfigured,
      model_provider: defaults.model_provider,
      default_model: defaults.model,
      default_reasoning_effort: defaults.model_reasoning_effort,
      auth_ready: authReady,
    };
    cliStatusCache = { at: Date.now(), key: cacheKey, val: status };
    return { ...status };
  }

  function parseTranscriptRefs(brainDir, convId) {
    if (!SAFE_ID_RE.test(convId)) return { childConvIds: [], taskIds: [] };
    const transcriptPath = join(brainDir, convId, '.system_generated', 'logs', 'transcript.jsonl');
    let st;
    try {
      st = statSync(transcriptPath);
    } catch {
      return { childConvIds: [], taskIds: [] };
    }

    const cached = transcriptCache.get(transcriptPath);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
      return cached;
    }

    const childSet = new Set();
    const taskSet = new Set();
    try {
      const text = readFileSync(transcriptPath, 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        if (line.includes('task_')) {
          const matches = line.match(TASK_ID_RE);
          if (matches) {
            for (const tid of matches) taskSet.add(tid);
          }
        }
        if (line.includes('conversationId') || line.includes('invoke_subagent')) {
          CONV_JSON_RE.lastIndex = 0;
          let m;
          while ((m = CONV_JSON_RE.exec(line)) !== null) {
            if (m[1] && m[1] !== convId) childSet.add(m[1]);
          }
        }
        if (line.includes('.system_generated/logs/')) {
          BRAIN_URI_RE.lastIndex = 0;
          let m;
          while ((m = BRAIN_URI_RE.exec(line)) !== null) {
            if (m[1] && m[1] !== convId) childSet.add(m[1]);
          }
        }
      }
    } catch {
      return { childConvIds: [], taskIds: [] };
    }

    const record = {
      mtimeMs: st.mtimeMs,
      size: st.size,
      childConvIds: [...childSet],
      taskIds: [...taskSet],
    };
    if (transcriptCache.size > 128) transcriptCache.clear();
    transcriptCache.set(transcriptPath, record);
    return record;
  }

  function resolveConversationScope(brainDir, rootConvId) {
    const conversationIds = new Set();
    const transcriptTaskIds = new Set();
    if (!SAFE_ID_RE.test(rootConvId || '')) {
      return { hasConversation: false, conversationIds, transcriptTaskIds, childCount: 0 };
    }

    const queue = [{ id: rootConvId, depth: 0 }];
    while (queue.length > 0) {
      const { id, depth } = queue.shift();
      if (!SAFE_ID_RE.test(id) || conversationIds.has(id)) continue;
      conversationIds.add(id);

      const refs = parseTranscriptRefs(brainDir, id);
      for (const tid of refs.taskIds) transcriptTaskIds.add(tid);
      if (depth < MAX_SUBAGENT_DEPTH) {
        for (const childId of refs.childConvIds) {
          if (!conversationIds.has(childId)) {
            queue.push({ id: childId, depth: depth + 1 });
          }
        }
      }
    }

    return {
      hasConversation: true,
      conversationIds,
      transcriptTaskIds,
      childCount: Math.max(0, conversationIds.size - 1),
    };
  }

  function collectRolloutFiles(sessionsDir, out = []) {
    let entries;
    try {
      entries = readdirSync(sessionsDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const ent of entries) {
      const fullPath = join(sessionsDir, ent.name);
      if (ent.isDirectory()) {
        collectRolloutFiles(fullPath, out);
      } else if (ent.isFile() && ent.name.endsWith('.jsonl')) {
        try {
          const st = statSync(fullPath);
          out.push({ path: fullPath, mtimeMs: st.mtimeMs, size: st.size });
        } catch {
          // ignore vanished file
        }
      }
    }
    return out;
  }

  function parseRolloutMetadata(fileInfo) {
    const cached = rolloutCache.get(fileInfo.path);
    if (cached && cached.mtimeMs === fileInfo.mtimeMs && cached.size === fileInfo.size) {
      return cached.meta;
    }

    let sessionId = null;
    let model = null;
    let effort = null;
    let usage = null;
    try {
      const text = readFileSync(fileInfo.path, 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        if (
          !line.includes('"session_meta"') &&
          !line.includes('"turn_context"') &&
          !line.includes('"token_count"')
        ) {
          continue;
        }
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        if (!ev || typeof ev !== 'object') continue;
        const p = ev.payload && typeof ev.payload === 'object' ? ev.payload : {};
        if (ev.type === 'session_meta' && typeof p.id === 'string' && p.id.trim()) {
          sessionId = p.id.trim();
        } else if (ev.type === 'turn_context') {
          if (typeof p.model === 'string' && p.model.trim()) model = p.model.trim();
          if (typeof p.effort === 'string' && p.effort.trim()) effort = p.effort.trim();
        } else if (ev.type === 'event_msg' && p.type === 'token_count' && p.info && typeof p.info === 'object') {
          const norm = normalizeUsage(p.info.total_token_usage);
          if (norm) usage = norm;
        }
      }
    } catch {
      return null;
    }

    const meta = sessionId ? { session_id: sessionId, model, reasoning_effort: effort, usage } : null;
    if (rolloutCache.size > MAX_CLI_SESSION_FILES * 2) rolloutCache.clear();
    rolloutCache.set(fileInfo.path, { mtimeMs: fileInfo.mtimeMs, size: fileInfo.size, meta });
    return meta;
  }

  function hydrateWorkersFromRollouts(workers, codexHomeDir) {
    const needsHydration = workers.some(
      (w) => w.session_id && (!w.model || !w.reasoning_effort || w.usage === null)
    );
    if (!needsHydration) return;

    const sessionsDir = join(codexHomeDir, 'sessions');
    if (!existsSync(sessionsDir)) return;

    const files = collectRolloutFiles(sessionsDir)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_CLI_SESSION_FILES);

    const metaBySession = new Map();
    for (const fileInfo of files) {
      const meta = parseRolloutMetadata(fileInfo);
      if (meta && !metaBySession.has(meta.session_id)) {
        metaBySession.set(meta.session_id, meta);
      }
    }

    for (const worker of workers) {
      if (!worker.session_id) continue;
      const meta = metaBySession.get(worker.session_id);
      if (!meta) continue;
      if (!worker.model && meta.model) worker.model = meta.model;
      if (!worker.reasoning_effort && meta.reasoning_effort) worker.reasoning_effort = meta.reasoning_effort;
      if (worker.usage === null && meta.usage) worker.usage = meta.usage;
    }
  }

  function readAndReconcileTaskFile(tasksDir, taskPath) {
    let record;
    try {
      record = JSON.parse(readFileSync(taskPath, 'utf8'));
    } catch {
      return null;
    }
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;

    if (record.status === 'running') {
      const pid = record.pid;
      const ownerPid = record.owner_pid;
      const pidDead = typeof pid === 'number' && pid > 0 && !isPidAlive(pid);
      const ownerDead = ownerPid === undefined || ownerPid === null || !isPidAlive(ownerPid);
      if (pidDead && ownerDead) {
        try {
          const latest = JSON.parse(readFileSync(taskPath, 'utf8'));
          if (latest && latest.status !== 'running') {
            return latest;
          }
          const failedRecord = {
            ...latest,
            status: 'failed',
            activity: 'failed',
            finished_at: latest.finished_at || Date.now() / 1000,
            error: 'Background task process is no longer running.',
          };
          const tmpPath = join(tasksDir, `.${basename(taskPath)}.${randomUUID().slice(0, 8)}.tmp`);
          writeFileSync(tmpPath, JSON.stringify(failedRecord, null, 2) + '\n', 'utf8');
          renameSync(tmpPath, taskPath);
          return failedRecord;
        } catch {
          return {
            ...record,
            status: 'failed',
            activity: 'failed',
            finished_at: record.finished_at || Date.now() / 1000,
            error: 'Background task process is no longer running.',
          };
        }
      }
    }
    return record;
  }

  function workerFromRecord(record, fallbackTaskId) {
    const status =
      record.status === 'running' || record.status === 'completed' || record.status === 'failed'
        ? record.status
        : 'completed';
    const mode = record.mode || 'exec';
    let activity = record.activity;
    if (typeof activity !== 'string' || !activity) {
      activity = status === 'running' ? (mode === 'review' ? 'reviewing' : 'thinking') : status;
    }
    const changedFiles = Array.isArray(record.changed_files)
      ? record.changed_files.map((item) => String(item))
      : [];

    let elapsedMs = 0;
    if (typeof record.elapsed_ms === 'number' && Number.isFinite(record.elapsed_ms) && record.elapsed_ms >= 0) {
      elapsedMs = Math.round(record.elapsed_ms);
    }
    if (status === 'running' && typeof record.started_at === 'number' && record.started_at > 0) {
      const wallElapsed = Math.max(0, Math.round(Date.now() - record.started_at * 1000));
      if (wallElapsed > elapsedMs) elapsedMs = wallElapsed;
    }

    const progressEvents =
      typeof record.progress_events === 'number'
        ? record.progress_events
        : typeof record.events_count === 'number'
          ? record.events_count
          : 0;

    const maxDurationSeconds =
      typeof record.max_duration_seconds === 'number' && Number.isFinite(record.max_duration_seconds)
        ? Math.round(record.max_duration_seconds)
        : null;
    const softBudgetSeconds =
      typeof record.soft_budget_seconds === 'number' && Number.isFinite(record.soft_budget_seconds)
        ? Math.round(record.soft_budget_seconds)
        : null;
    const maxIdleSeconds =
      typeof record.max_idle_seconds === 'number' && Number.isFinite(record.max_idle_seconds)
        ? Math.round(record.max_idle_seconds)
        : null;
    let idleMs =
      typeof record.idle_ms === 'number' && Number.isFinite(record.idle_ms) && record.idle_ms >= 0
        ? Math.round(record.idle_ms)
        : 0;
    if (status === 'running' && typeof record.last_event_at === 'number' && record.last_event_at > 0) {
      idleMs = Math.max(0, Math.round(Date.now() - record.last_event_at * 1000));
    }
    const remainingMs =
      status === 'running' && maxDurationSeconds !== null
        ? Math.max(0, maxDurationSeconds * 1000 - elapsedMs)
        : null;

    return {
      worker_id: String(record.task_id || fallbackTaskId),
      source: 'bridge',
      task_id: record.task_id || fallbackTaskId,
      session_id: record.session_id || null,
      conversation_id: record.conversation_id || null,
      mode,
      sandbox: record.sandbox || null,
      cwd: record.cwd || null,
      model: record.model || null,
      reasoning_effort: record.reasoning_effort || null,
      status,
      activity,
      timed_out: Boolean(record.timed_out || activity === 'timed_out'),
      timeout_reason: typeof record.timeout_reason === 'string' ? record.timeout_reason : null,
      max_duration_seconds: maxDurationSeconds,
      soft_budget_seconds: softBudgetSeconds,
      max_idle_seconds: maxIdleSeconds,
      idle_ms: idleMs,
      remaining_ms: remainingMs,
      usage: normalizeUsage(record.usage),
      changed_files: changedFiles,
      changed_files_count: changedFiles.length,
      started_at: record.started_at || null,
      finished_at: record.finished_at || null,
      elapsed_ms: elapsedMs,
      progress_events: progressEvents,
      prompt_preview: record.prompt_preview || null,
      error: record.error || null,
    };
  }

  function aggregateStats(workers) {
    let runningCount = 0;
    let completedCount = 0;
    let failedCount = 0;
    let inputTokens = 0;
    let cachedTokens = 0;
    let outputTokens = 0;
    let reasonTokens = 0;
    let totalTokens = 0;
    let totalElapsedMs = 0;
    let totalChangedFiles = 0;

    const byModelMap = new Map();
    const byEffortMap = new Map();
    const byModeMap = new Map();

    for (const w of workers) {
      if (w.status === 'running') runningCount += 1;
      else if (w.status === 'failed') failedCount += 1;
      else completedCount += 1;

      const u = w.usage || {};
      const wTok = Number(u.total_tokens || 0);
      inputTokens += Number(u.input_tokens || 0);
      cachedTokens += Number(u.cached_input_tokens || 0);
      outputTokens += Number(u.output_tokens || 0);
      reasonTokens += Number(u.reasoning_output_tokens || 0);
      totalTokens += wTok;

      totalElapsedMs += Number(w.elapsed_ms || 0);
      totalChangedFiles += Number(w.changed_files_count || 0);

      const mKey = w.model || 'unknown';
      const mEntry = byModelMap.get(mKey) || { model: mKey, count: 0, running: 0, total_tokens: 0 };
      mEntry.count += 1;
      if (w.status === 'running') mEntry.running += 1;
      mEntry.total_tokens += wTok;
      byModelMap.set(mKey, mEntry);

      const eKey = w.reasoning_effort || 'default';
      const eEntry = byEffortMap.get(eKey) || { effort: eKey, count: 0, total_tokens: 0 };
      eEntry.count += 1;
      eEntry.total_tokens += wTok;
      byEffortMap.set(eKey, eEntry);

      const modeKey = w.mode || 'exec';
      const modeEntry = byModeMap.get(modeKey) || { mode: modeKey, count: 0, total_tokens: 0 };
      modeEntry.count += 1;
      modeEntry.total_tokens += wTok;
      byModeMap.set(modeKey, modeEntry);
    }

    const totalWorkers = workers.length;
    const finishedCount = completedCount + failedCount;
    const cacheHitRate = inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 10000) / 10000 : 0.0;
    const successRate = finishedCount > 0 ? Math.round((completedCount / finishedCount) * 10000) / 10000 : 0.0;
    const avgElapsedMs = totalWorkers > 0 ? Math.floor(totalElapsedMs / totalWorkers) : 0;

    return {
      total_workers: totalWorkers,
      running_count: runningCount,
      completed_count: completedCount,
      failed_count: failedCount,
      bridge_count: totalWorkers,
      cli_count: 0,
      tokens: {
        input_tokens: inputTokens,
        cached_input_tokens: cachedTokens,
        output_tokens: outputTokens,
        reasoning_output_tokens: reasonTokens,
        total_tokens: totalTokens,
        cache_hit_rate: cacheHitRate,
      },
      total_elapsed_ms: totalElapsedMs,
      avg_elapsed_ms: avgElapsedMs,
      total_changed_files: totalChangedFiles,
      success_rate: successRate,
      by_model: [...byModelMap.values()].sort(
        (a, b) =>
          b.running - a.running ||
          b.total_tokens - a.total_tokens ||
          b.count - a.count ||
          a.model.localeCompare(b.model)
      ),
      by_effort: [...byEffortMap.values()].sort(
        (a, b) => b.count - a.count || b.total_tokens - a.total_tokens || a.effort.localeCompare(b.effort)
      ),
      by_mode: [...byModeMap.values()].sort(
        (a, b) => b.count - a.count || b.total_tokens - a.total_tokens || a.mode.localeCompare(b.mode)
      ),
    };
  }

  function taskBelongsToScope(record, taskId, scopeInfo) {
    if (record.conversation_id && scopeInfo.conversationIds.has(record.conversation_id)) {
      return true;
    }
    if (scopeInfo.transcriptTaskIds.has(taskId)) {
      return true;
    }
    return false;
  }

  async function getSnapshot({ conversationId = '', scope = 'conversation', limit = 50 } = {}) {
    const clampedLimit = Math.max(1, Math.min(200, Number(limit) || 50));
    const cleanScope = scope === 'all' ? 'all' : 'conversation';
    const paths = resolvePaths(env);
    const cliStatus = await getCachedCliStatus();
    const freshDefaults = readCodexDefaults(paths.codexHomeDir);
    const pluginSettings = readPluginSettings(paths.pluginDataDir, env);
    const codexDefaultModel = freshDefaults.model || cliStatus.default_model || null;
    const effectiveDefaultModel = pluginSettings.default_model || codexDefaultModel || null;
    const availableModels = readAvailableCodexModels(
      paths.codexHomeDir,
      freshDefaults,
      pluginSettings.default_model
    );
    const mergedCliStatus = {
      ...cliStatus,
      model_provider: freshDefaults.model_provider ?? cliStatus.model_provider,
      default_model: effectiveDefaultModel,
      codex_default_model: codexDefaultModel,
      plugin_default_model: pluginSettings.default_model,
      default_reasoning_effort: freshDefaults.model_reasoning_effort ?? cliStatus.default_reasoning_effort,
    };
    const settings = {
      default_model: pluginSettings.default_model,
      effective_model: effectiveDefaultModel,
      codex_default_model: codexDefaultModel,
      source: pluginSettings.source,
      available_models: availableModels,
    };
    const scopeInfo = resolveConversationScope(paths.brainDir, conversationId);

    const workers = [];
    if (existsSync(paths.tasksDir) && (cleanScope === 'all' || scopeInfo.hasConversation)) {
      let files = [];
      try {
        files = readdirSync(paths.tasksDir).filter((f) => f.startsWith('task_') && f.endsWith('.json'));
      } catch {
        files = [];
      }
      for (const fname of files) {
        const taskPath = join(paths.tasksDir, fname);
        const rec = readAndReconcileTaskFile(paths.tasksDir, taskPath);
        if (!rec) continue;
        const tid = String(rec.task_id || fname.slice(0, -5));
        if (cleanScope === 'conversation' && !taskBelongsToScope(rec, tid, scopeInfo)) {
          continue;
        }
        workers.push(workerFromRecord(rec, tid));
      }
    }

    hydrateWorkersFromRollouts(workers, paths.codexHomeDir);

    workers.sort((a, b) => {
      const ra = a.status === 'running' ? 0 : 1;
      const rb = b.status === 'running' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      const ta = Number(a.finished_at || a.started_at || 0);
      const tb = Number(b.finished_at || b.started_at || 0);
      if (ta !== tb) return tb - ta;
      return String(a.worker_id).localeCompare(String(b.worker_id));
    });

    const stats = aggregateStats(workers);
    return {
      generated_at: Date.now() / 1000,
      scope: cleanScope,
      conversation_id: scopeInfo.hasConversation ? conversationId : null,
      has_conversation: scopeInfo.hasConversation,
      subagent_count: scopeInfo.childCount,
      cli_status: mergedCliStatus,
      settings,
      stats,
      workers: workers.slice(0, clampedLimit),
    };
  }

  function updateSettings({ default_model = null } = {}) {
    const paths = resolvePaths(env);
    return writePluginSettings(paths.pluginDataDir, { default_model });
  }

  function clearFinishedTasks({ conversationId = '', scope = 'conversation' } = {}) {
    const cleanScope = scope === 'all' ? 'all' : 'conversation';
    const paths = resolvePaths(env);
    const scopeInfo = resolveConversationScope(paths.brainDir, conversationId);
    if (!existsSync(paths.tasksDir)) return 0;
    if (cleanScope === 'conversation' && !scopeInfo.hasConversation) return 0;

    let removed = 0;
    let files = [];
    try {
      files = readdirSync(paths.tasksDir).filter((f) => f.startsWith('task_') && f.endsWith('.json'));
    } catch {
      return 0;
    }

    for (const fname of files) {
      const taskPath = join(paths.tasksDir, fname);
      const rec = readAndReconcileTaskFile(paths.tasksDir, taskPath);
      if (!rec || rec.status === 'running') continue;
      const tid = String(rec.task_id || fname.slice(0, -5));
      if (cleanScope === 'conversation' && !taskBelongsToScope(rec, tid, scopeInfo)) {
        continue;
      }
      try {
        unlinkSync(taskPath);
        removed += 1;
      } catch {
        // ignore concurrent unlink
      }
    }
    return removed;
  }

  return {
    getSnapshot,
    clearFinishedTasks,
    updateSettings,
    resolveConversationScope: (convId) => resolveConversationScope(resolvePaths(env).brainDir, convId),
    resolvePaths: () => resolvePaths(env),
  };
}

function escapeStyleClose(cssText) {
  return String(cssText).replace(/<\/style/gi, '<\\/style');
}

function escapeScriptClose(jsText) {
  return String(jsText).replace(/<\/script/gi, '<\\/script');
}

const DRAGON_GIF_STATES = ['idle', 'thinking', 'coding', 'reviewing', 'completed', 'failed'];

export function loadDragonGifDataUris(sidecarDir) {
  const dragonDir = join(sidecarDir, 'assets', 'dragon');
  const map = {};
  for (const state of DRAGON_GIF_STATES) {
    const filePath = join(dragonDir, `${state}.gif`);
    if (!existsSync(filePath)) continue;
    try {
      const b64 = readFileSync(filePath).toString('base64');
      if (b64) map[state] = `data:image/gif;base64,${b64}`;
    } catch {
      // skip unreadable asset
    }
  }
  return map;
}

export function buildMonitorHtml(sidecarDir) {
  const html = readFileSync(join(sidecarDir, 'index.html'), 'utf8');
  const css = readFileSync(join(sidecarDir, 'styles.css'), 'utf8');
  const spritesJs = readFileSync(join(sidecarDir, 'sprites.js'), 'utf8');
  const appJs = readFileSync(join(sidecarDir, 'app.js'), 'utf8');
  const dragonGifs = loadDragonGifDataUris(sidecarDir);

  const styleBlock = `<style>\n${escapeStyleClose(css)}\n  </style>`;
  const dragonBlock =
    Object.keys(dragonGifs).length > 0
      ? `<script>\nglobalThis.__CODEX_DRAGON_GIFS__ = ${escapeScriptClose(JSON.stringify(dragonGifs))};\n  </script>\n  `
      : '';
  const scriptBlock = `${dragonBlock}<script>\n${escapeScriptClose(spritesJs)}\n  </script>\n  <script>\n${escapeScriptClose(appJs)}\n  </script>`;

  return html
    .replace(/<!--INLINE_STYLES_START-->[\s\S]*?<!--INLINE_STYLES_END-->/, () => styleBlock)
    .replace(/<!--INLINE_SCRIPTS_START-->[\s\S]*?<!--INLINE_SCRIPTS_END-->/, () => scriptBlock);
}
