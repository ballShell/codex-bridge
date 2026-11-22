(() => {
  'use strict';

  const sprites = globalThis.CodexSprites || {};
  const ANIMATION_STATES = Array.isArray(sprites.ANIMATION_STATES)
    ? sprites.ANIMATION_STATES
    : ['idle', 'thinking', 'coding', 'reviewing', 'completed', 'failed'];
  const drawWorkerSprite =
    typeof sprites.drawWorkerSprite === 'function' ? sprites.drawWorkerSprite : () => {};
  const drawWorkshopStage =
    typeof sprites.drawWorkshopStage === 'function' ? sprites.drawWorkshopStage : () => [];
  const getPaletteForWorker =
    typeof sprites.getPaletteForWorker === 'function'
      ? sprites.getPaletteForWorker
      : () => ({ accent: '#38bdf8' });
  const resolveSpriteState =
    typeof sprites.resolveSpriteState === 'function' ? sprites.resolveSpriteState : () => 'idle';

  const I18N = {
  zh: {
    title: 'Codex Monitor',
    refresh: '刷新',
    clearDone: '清理已完成',
    stageTitle: '像素工坊 (多 Codex 实时动态)',
    poseLive: '实时状态',
    poses: {
      idle: '闲置',
      thinking: '思考',
      coding: '编码',
      reviewing: '审查',
      completed: '完成',
      failed: '异常',
    },
    statsTitle: '工作量统计',
    kpiActive: '运行中 / 总任务',
    kpiTokens: '累计 Token 消耗',
    kpiTime: '累计工作耗时',
    kpiFiles: '改动文件 / 成功率',
    cacheHit: '缓存命中',
    avgTime: '平均',
    scopeConv: '当前会话',
    scopeConvSubs: (n) => `当前会话 (+${n} 子代理)`,
    scopeAll: '全部会话',
    cliReady: 'CLI 就绪',
    cliNotReady: 'CLI 未就绪',
    workersTitle: 'Codex 工作状态',
    statusAll: '全部',
    statusRunning: '执行中',
    statusCompleted: '已完成',
    statusFailed: '失败',
    emptyTitleNoConv: '未检测到当前对话',
    emptyTitleNoWorkers: '当前会话暂无 Codex 任务',
    emptyTitleNoWorkersAll: '暂无 Codex 运行记录',
    emptyTitleFilter: '当前筛选条件下无任务',
    errorBannerTitle: '刷新监控数据时出现异常',
    retryBtn: '重试',
    bootErrorTitle: 'Codex Monitor 渲染异常',
    loading: '正在加载会话监控数据…',
    connecting: '检测中…',
    pollError: '刷新失败',
    inputTok: '输入',
    cachedTok: '缓存',
    outputTok: '输出',
    reasonTok: '推理',
    changedFiles: '改动文件',
    sessionId: 'Codex 会话',
    convId: '所属对话',
    workdir: '工作目录',
    errorLabel: '错误信息',
    statusText: {
      running: '执行中',
      completed: '已完成',
      failed: '失败',
    },
    actText: {
      idle: '待命',
      starting: '启动中',
      thinking: '思考规划',
      coding: '编写/执行',
      reviewing: '代码审查',
      completed: '已完成',
      failed: '异常中断',
    },
    unknownModel: '未知模型',
    defaultEffort: '默认强度',
  },
  en: {
    title: 'Codex Monitor',
    refresh: 'Refresh',
    clearDone: 'Clear Done',
    stageTitle: 'Pixel Workshop (Live Codex Fleet)',
    poseLive: 'Live',
    poses: {
      idle: 'Idle',
      thinking: 'Think',
      coding: 'Code',
      reviewing: 'Review',
      completed: 'Done',
      failed: 'Fail',
    },
    statsTitle: 'Work Statistics',
    kpiActive: 'Running / Total',
    kpiTokens: 'Total Tokens',
    kpiTime: 'Total Work Time',
    kpiFiles: 'Files / Success',
    cacheHit: 'Cache hit',
    avgTime: 'Avg',
    scopeConv: 'This Chat',
    scopeConvSubs: (n) => `This Chat (+${n} sub)`,
    scopeAll: 'All Chats',
    cliReady: 'CLI Ready',
    cliNotReady: 'CLI Not Ready',
    workersTitle: 'Codex Workers',
    statusAll: 'All',
    statusRunning: 'Running',
    statusCompleted: 'Done',
    statusFailed: 'Failed',
    emptyTitleNoConv: 'No Active Conversation',
    emptyTitleNoWorkers: 'No Codex Tasks in This Chat',
    emptyTitleNoWorkersAll: 'No Codex Tasks Yet',
    emptyTitleFilter: 'No Matching Codex Tasks',
    errorBannerTitle: 'Monitor sync error',
    retryBtn: 'Retry',
    bootErrorTitle: 'Codex Monitor Render Error',
    loading: 'Loading conversation monitor…',
    connecting: 'Checking…',
    pollError: 'Sync failed',
    inputTok: 'In',
    cachedTok: 'Cache',
    outputTok: 'Out',
    reasonTok: 'Reason',
    changedFiles: 'Changed Files',
    sessionId: 'Codex Session',
    convId: 'Conversation',
    workdir: 'Workspace',
    errorLabel: 'Error',
    statusText: {
      running: 'Running',
      completed: 'Done',
      failed: 'Failed',
    },
    actText: {
      idle: 'Idle',
      starting: 'Starting',
      thinking: 'Thinking',
      coding: 'Coding',
      reviewing: 'Reviewing',
      completed: 'Completed',
      failed: 'Failed',
    },
    unknownModel: 'unknown',
    defaultEffort: 'default',
  },
};

const MODEL_COLORS = ['#22d3ee', '#fbbf24', '#34d399', '#c084fc', '#fb923c', '#f472b6'];

const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');

function doFetch(url, options) {
  if (window.sidecar && typeof window.sidecar.fetch === 'function') {
    return window.sidecar.fetch(url, options);
  }
  return window.fetch(url, options);
}

function getConversationId() {
  return (window.sidecar && window.sidecar.conversationId) || params.get('conversationId') || '';
}

function detectThemeFromComputedBg() {
  try {
    const rootEl = document.documentElement;
    if (rootEl && typeof document.createElement === 'function' && typeof getComputedStyle === 'function') {
      const probe = document.createElement('span');
      probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #f7f7f8)';
      if (typeof rootEl.appendChild === 'function') {
        rootEl.appendChild(probe);
        const c = getComputedStyle(probe).color || '';
        if (typeof probe.remove === 'function') probe.remove();
        const nums = (c.match(/[\d.]+/g) || []).map(Number);
        if (nums.length >= 3 && !(nums.length >= 4 && nums[3] === 0)) {
          const scale = c.startsWith('color(') ? 1 : 255;
          const [r, g, b] = nums.slice(0, 3).map((v) => v / scale);
          const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          return lum < 0.5 ? 'dark' : 'light';
        }
      }
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
  } catch {
    // fallback below
  }
  return 'light';
}

function makeEmptySnapshot() {
  const convId = getConversationId();
  return {
    generated_at: Date.now() / 1000,
    scope: state.scope,
    conversation_id: convId || null,
    has_conversation: Boolean(convId),
    subagent_count: 0,
    cli_status: null,
    stats: {
      total_workers: 0,
      running_count: 0,
      completed_count: 0,
      failed_count: 0,
      bridge_count: 0,
      cli_count: 0,
      tokens: {
        input_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_output_tokens: 0,
        total_tokens: 0,
        cache_hit_rate: 0,
      },
      total_elapsed_ms: 0,
      avg_elapsed_ms: 0,
      total_changed_files: 0,
      success_rate: 0,
      by_model: [],
      by_effort: [],
      by_mode: [],
    },
    workers: [],
  };
}

const initialLang = ((typeof navigator !== 'undefined' && navigator.language) || '').toLowerCase().startsWith('en')
  ? 'en'
  : 'zh';

const state = {
  lang: initialLang,
  theme: detectThemeFromComputedBg(),
  snapshot: null,
  lastRenderSignature: '',
  snapshotReceivedMs: Date.now(),
  scope: 'conversation',
  statusFilter: 'all',
  previewState: null,
  selectedWorkerId: null,
  expandedIds: new Set(),
  pollingInFlight: false,
  lastError: null,
  pollTimer: null,
  stageHitboxes: [],
  spriteTick: 0,
};

if (document.documentElement) {
  document.documentElement.setAttribute('data-theme', state.theme);
}

function t() {
  return I18N[state.lang] || I18N.zh;
}

function escapeHtml(val) {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(n) {
  const num = Number(n || 0);
  if (!Number.isFinite(num) || num <= 0) return '0';
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 10_000) return `${(num / 1_000).toFixed(1)}K`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return String(Math.round(num));
}

function formatDurationMs(ms) {
  const totalSec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins < 60) return `${mins}m ${String(secs).padStart(2, '0')}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m`;
}

function computeLiveElapsedMs(worker) {
  const base = Number(worker.elapsed_ms || 0);
  if (worker.status !== 'running') return base;
  const delta = Math.max(0, Date.now() - state.snapshotReceivedMs);
  return base + delta;
}

function getFilteredWorkers() {
  const all = state.snapshot?.workers || [];
  return all.filter((w) => {
    if (state.statusFilter !== 'all' && w.status !== state.statusFilter) return false;
    return true;
  });
}

function renderStatsSection(snap, tr) {
  const stats = snap?.stats || {};
  const tok = stats.tokens || {};
  const running = stats.running_count || 0;
  const total = stats.total_workers || 0;
  const completed = stats.completed_count || 0;
  const failed = stats.failed_count || 0;
  const cacheRatePct = Math.round((tok.cache_hit_rate || 0) * 100);
  const successRatePct =
    completed + failed > 0 ? `${Math.round((stats.success_rate || 0) * 100)}%` : '—';

  const byModel = stats.by_model || [];
  const modelTokSum = byModel.reduce((acc, m) => acc + (m.total_tokens || 0), 0);
  const useCountRatio = modelTokSum === 0;
  const modelCountSum = byModel.reduce((acc, m) => acc + (m.count || 0), 0);

  const stackSegments = byModel
    .map((m, idx) => {
      const weight = useCountRatio ? m.count || 0 : m.total_tokens || 0;
      const denom = useCountRatio ? modelCountSum : modelTokSum;
      const pct = denom > 0 ? Math.max(4, Math.round((weight / denom) * 1000) / 10) : 0;
      const color = MODEL_COLORS[idx % MODEL_COLORS.length];
      return `<div class="stack-seg" style="width:${pct}%;background:${color}" title="${escapeHtml(m.model)}: ${formatNumber(m.total_tokens)} tok (${m.count})"></div>`;
    })
    .join('');

  const modelPills = byModel
    .slice(0, 6)
    .map((m, idx) => {
      const color = MODEL_COLORS[idx % MODEL_COLORS.length];
      const runTag = m.running > 0 ? ` · ${m.running}▶` : '';
      return `<span class="stat-pill"><span class="dot-swatch" style="background:${color}"></span>${escapeHtml(m.model)} ×${m.count}${runTag} · ${formatNumber(m.total_tokens)}</span>`;
    })
    .join('');

  const effortPills = (stats.by_effort || [])
    .map((e) => `<span class="stat-pill">⚡ ${escapeHtml(e.effort)} ×${e.count}</span>`)
    .join('');

  const modePills = (stats.by_mode || [])
    .map((m) => `<span class="stat-pill"># ${escapeHtml(m.mode)} ×${m.count}</span>`)
    .join('');

  const subCount = snap?.subagent_count || 0;
  const scopeBadgeText =
    state.scope === 'all'
      ? tr.scopeAll
      : subCount > 0
        ? tr.scopeConvSubs(subCount)
        : tr.scopeConv;

  return `
    <section class="panel">
      <div class="panel-head">
        <span class="panel-title">${escapeHtml(tr.statsTitle)}</span>
        <span class="conv-pill">${escapeHtml(scopeBadgeText)}</span>
      </div>
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">${escapeHtml(tr.kpiActive)}</div>
          <div class="kpi-value">${running} / ${total}</div>
          <div class="kpi-sub">✓ ${completed} · ✕ ${failed}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${escapeHtml(tr.kpiTokens)}</div>
          <div class="kpi-value">${formatNumber(tok.total_tokens)}</div>
          <div class="kpi-sub">${escapeHtml(tr.cacheHit)} ${cacheRatePct}% · ${escapeHtml(tr.outputTok)} ${formatNumber(tok.output_tokens)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${escapeHtml(tr.kpiTime)}</div>
          <div class="kpi-value">${formatDurationMs(stats.total_elapsed_ms)}</div>
          <div class="kpi-sub">${escapeHtml(tr.avgTime)} ${formatDurationMs(stats.avg_elapsed_ms)}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${escapeHtml(tr.kpiFiles)}</div>
          <div class="kpi-value">${stats.total_changed_files || 0} / ${successRatePct}</div>
          <div class="kpi-sub">${escapeHtml(tr.reasonTok)} ${formatNumber(tok.reasoning_output_tokens)}</div>
        </div>
      </div>
      ${
        byModel.length > 0
          ? `
        <div class="breakdown-block">
          <div class="stack-bar">${stackSegments}</div>
          <div class="pill-row">${modelPills}</div>
          <div class="pill-row">${effortPills}${modePills}</div>
        </div>
      `
          : ''
      }
    </section>
  `;
}

function renderWorkerCard(worker, idx, tr) {
  const id = worker.worker_id;
  const status = worker.status || 'completed';
  const activity = resolveSpriteState(worker);
  const effort = worker.reasoning_effort || tr.defaultEffort;
  const model = worker.model || tr.unknownModel;
  const palette = getPaletteForWorker(worker, idx);
  const expanded = state.expandedIds.has(id);
  const selected = state.selectedWorkerId === id;

  const usage = worker.usage || {};
  const inTok = usage.input_tokens || 0;
  const cacheTok = usage.cached_input_tokens || 0;
  const uncachedIn = Math.max(0, inTok - cacheTok);
  const outTok = usage.output_tokens || 0;
  const reasonTok = usage.reasoning_output_tokens || 0;
  const totTok = usage.total_tokens || 0;
  const barDenom = Math.max(1, cacheTok + uncachedIn + outTok);

  const effortClass = `effort-${String(worker.reasoning_effort || 'medium').toLowerCase()}`;
  const statusLabel = tr.statusText[status] || status;
  const actLabel = tr.actText[worker.activity] || tr.actText[activity] || activity;

  const previewText = worker.prompt_preview || worker.cwd || worker.session_id || id;
  const changed = Array.isArray(worker.changed_files) ? worker.changed_files : [];

  return `
    <article class="worker-card ${escapeHtml(status)} ${selected ? 'selected' : ''}" data-worker-id="${escapeHtml(id)}">
      <div class="worker-main" data-toggle-worker="${escapeHtml(id)}" style="cursor:pointer">
        <div class="sprite-box">
          <canvas class="worker-sprite" width="48" height="48" data-sprite-worker="${escapeHtml(id)}"></canvas>
        </div>
        <div class="worker-info">
          <div class="worker-top-row">
            <div class="worker-badges">
              <span class="badge"><span class="dot-swatch" style="display:inline-block;margin-right:4px;background:${palette.accent}"></span>${escapeHtml(model)}</span>
              <span class="badge ${escapeHtml(effortClass)}">⚡ ${escapeHtml(effort)}</span>
              <span class="badge source-bridge">${escapeHtml(worker.mode || 'exec')}</span>
            </div>
            <span class="status-chip ${escapeHtml(status)}">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="worker-meta-row">
            <span>${escapeHtml(actLabel)} · <strong class="live-elapsed" data-elapsed-worker="${escapeHtml(id)}">${formatDurationMs(computeLiveElapsedMs(worker))}</strong></span>
            <span>${totTok > 0 ? `${formatNumber(totTok)} tok` : '— tok'}</span>
          </div>
          ${
            totTok > 0
              ? `
            <div class="token-strip" title="${escapeHtml(tr.cachedTok)}: ${formatNumber(cacheTok)} | ${escapeHtml(tr.inputTok)}: ${formatNumber(inTok)} | ${escapeHtml(tr.outputTok)}: ${formatNumber(outTok)}">
              <div class="tok-cached" style="width:${(cacheTok / barDenom) * 100}%"></div>
              <div class="tok-uncached" style="width:${(uncachedIn / barDenom) * 100}%"></div>
              <div class="tok-output" style="width:${(outTok / barDenom) * 100}%"></div>
            </div>
          `
              : ''
          }
          <div class="worker-preview" title="${escapeHtml(previewText)}">${escapeHtml(previewText)}</div>
        </div>
      </div>
      ${
        expanded
          ? `
        <div class="worker-details">
          <div>${escapeHtml(tr.inputTok)}: ${formatNumber(inTok)} · ${escapeHtml(tr.cachedTok)}: ${formatNumber(cacheTok)} · ${escapeHtml(tr.outputTok)}: ${formatNumber(outTok)} · ${escapeHtml(tr.reasonTok)}: ${formatNumber(reasonTok)}</div>
          ${worker.session_id ? `<div>${escapeHtml(tr.sessionId)}: ${escapeHtml(worker.session_id)}</div>` : ''}
          ${worker.conversation_id ? `<div>${escapeHtml(tr.convId)}: ${escapeHtml(worker.conversation_id)}</div>` : ''}
          ${worker.cwd ? `<div>${escapeHtml(tr.workdir)}: ${escapeHtml(worker.cwd)}</div>` : ''}
          ${changed.length > 0 ? `<div>${escapeHtml(tr.changedFiles)} (${changed.length}): ${escapeHtml(changed.join(', '))}</div>` : ''}
          ${worker.error ? `<div class="detail-err">${escapeHtml(tr.errorLabel)}: ${escapeHtml(worker.error)}</div>` : ''}
        </div>
      `
          : ''
      }
    </article>
  `;
}

function renderBootError(err) {
  const root = document.getElementById('app');
  if (!root) return;
  const tr = t();
  const msg = String(err?.stack || err?.message || err || 'Unknown error');
  root.innerHTML = `
    <div class="app-shell">
      <div class="error-banner" role="alert">
        <div><strong>${escapeHtml(tr.bootErrorTitle)}</strong></div>
        <div class="worker-preview" style="white-space:normal;word-break:break-word">${escapeHtml(msg)}</div>
      </div>
    </div>
  `;
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;
  try {
    const tr = t();
    const hasLoaded = Boolean(state.snapshot);
    const snap = state.snapshot || makeEmptySnapshot();
    const cli = snap.cli_status || {};
    const runningCount = snap.stats?.running_count || 0;

    const cliReady = Boolean(cli.binary_found && cli.auth_ready);
    const cliSummary = hasLoaded
      ? `${cliReady ? tr.cliReady : tr.cliNotReady}${cli.default_model ? ` · ${cli.default_model}` : ''}`
      : tr.connecting;

    const poseButtons = [
      `<button class="pose-chip ${state.previewState === null ? 'active' : ''}" data-pose="live">${escapeHtml(tr.poseLive)}</button>`,
      ...ANIMATION_STATES.map(
        (pose) =>
          `<button class="pose-chip ${state.previewState === pose ? 'active' : ''}" data-pose="${pose}">${escapeHtml(tr.poses[pose] || pose)}</button>`
      ),
    ].join('');

    const totalInSnap = (snap.workers || []).length;
    const filtered = getFilteredWorkers();
    const hasFinished = (snap.workers || []).some((w) => w.status !== 'running');

    let emptyTitle = tr.emptyTitleNoWorkers;
    if (totalInSnap > 0 && filtered.length === 0) {
      emptyTitle = tr.emptyTitleFilter;
    } else if (hasLoaded && state.scope === 'conversation' && !snap.has_conversation) {
      emptyTitle = tr.emptyTitleNoConv;
    } else if (state.scope === 'all') {
      emptyTitle = tr.emptyTitleNoWorkersAll;
    }

    const emptyCardHtml = `
      <div class="empty-card">
        <div class="empty-title">${escapeHtml(emptyTitle)}</div>
      </div>
    `;

    root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand">
            <span class="live-dot ${runningCount > 0 ? 'active' : ''}"></span>
            <span class="title-text">${escapeHtml(tr.title)}</span>
            <span class="cli-pill ${hasLoaded ? (cliReady ? 'ready' : 'warn') : ''}" title="${escapeHtml(cliSummary)}">${escapeHtml(cliSummary)}</span>
          </div>
          <div class="controls">
            ${state.lastError ? `<span class="kpi-sub" style="color:var(--err)">${escapeHtml(tr.pollError)}</span>` : ''}
            <button class="btn" id="btn-refresh" ${state.pollingInFlight ? 'disabled' : ''}>${escapeHtml(tr.refresh)}</button>
            <button class="btn" id="btn-lang">${state.lang === 'zh' ? 'EN' : '中文'}</button>
          </div>
        </header>

        ${
          state.lastError
            ? `
          <div class="error-banner" role="alert">
            <div>
              <strong>${escapeHtml(tr.errorBannerTitle)}</strong>
              <span style="margin-left:6px;opacity:0.9">${escapeHtml(state.lastError)}</span>
            </div>
            <button class="btn" id="btn-retry" ${state.pollingInFlight ? 'disabled' : ''}>${escapeHtml(tr.retryBtn)}</button>
          </div>
        `
            : ''
        }

        <section class="panel">
          <div class="panel-head">
            <span class="panel-title">${escapeHtml(tr.stageTitle)}</span>
            <span class="kpi-sub">${runningCount > 0 ? `${runningCount}▶` : 'Standby'}</span>
          </div>
          <div class="stage-wrap">
            <canvas id="workshop-canvas"></canvas>
          </div>
          <div class="pose-strip">${poseButtons}</div>
        </section>

        ${renderStatsSection(snap, tr)}

        <section class="panel">
          <div class="panel-head">
            <span class="panel-title">${escapeHtml(tr.workersTitle)} (${filtered.length})</span>
            <button class="btn" id="btn-clear" ${hasFinished && !state.pollingInFlight ? '' : 'disabled'}>${escapeHtml(tr.clearDone)}</button>
          </div>
          <div class="toolbar">
            <div class="tab-group">
              ${['conversation', 'all']
                .map((sc) => {
                  const label = sc === 'conversation' ? tr.scopeConv : tr.scopeAll;
                  return `<button class="tab-btn ${state.scope === sc ? 'active' : ''}" data-scope="${sc}">${escapeHtml(label)}</button>`;
                })
                .join('')}
            </div>
            <div class="tab-group">
              ${['all', 'running', 'completed', 'failed']
                .map((st) => {
                  const label =
                    st === 'all'
                      ? tr.statusAll
                      : st === 'running'
                        ? tr.statusRunning
                        : st === 'completed'
                          ? tr.statusCompleted
                          : tr.statusFailed;
                  return `<button class="tab-btn ${state.statusFilter === st ? 'active' : ''}" data-status="${st}">${escapeHtml(label)}</button>`;
                })
                .join('')}
            </div>
          </div>
          <div class="workers-list">
            ${
              filtered.length > 0
                ? filtered.map((w, i) => renderWorkerCard(w, i, tr)).join('')
                : emptyCardHtml
            }
          </div>
        </section>
      </div>
    `;

    drawAllSprites();
    window.__codexMonitorMounted = true;
  } catch (err) {
    renderBootError(err);
  }
}

function drawAllSprites() {
  try {
    const workers = state.snapshot?.workers || [];
    const stageCanvas = document.getElementById('workshop-canvas');
    if (stageCanvas) {
      state.stageHitboxes = drawWorkshopStage(
        stageCanvas,
        workers,
        {
          theme: state.theme,
          previewState: state.previewState,
          selectedWorkerId: state.selectedWorkerId,
        },
        state.spriteTick
      );
    }

    const byId = new Map(workers.map((w, idx) => [w.worker_id, { worker: w, idx }]));
    if (typeof document.querySelectorAll === 'function') {
      document.querySelectorAll('canvas[data-sprite-worker]').forEach((canvas) => {
        const id = canvas.getAttribute('data-sprite-worker');
        const entry = id ? byId.get(id) : null;
        if (!entry) return;
        const { worker, idx } = entry;
        const spriteState = resolveSpriteState(worker);
        const palette = getPaletteForWorker(worker, idx);
        drawWorkerSprite(
          canvas,
          spriteState,
          palette,
          state.spriteTick + idx * 2,
          worker.reasoning_effort || 'medium',
          state.theme
        );
      });
    }
  } catch {
    // keep DOM rendered even if a canvas draw fails in minimal environments
  }
}

function updateLiveTimers() {
  const workers = state.snapshot?.workers || [];
  const byId = new Map(workers.map((w) => [w.worker_id, w]));
  document.querySelectorAll('[data-elapsed-worker]').forEach((el) => {
    const id = el.getAttribute('data-elapsed-worker');
    const worker = id ? byId.get(id) : null;
    if (worker && worker.status === 'running') {
      el.textContent = formatDurationMs(computeLiveElapsedMs(worker));
    }
  });
}

function scheduleNextPoll() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  if (document.hidden) return;
  const running = state.snapshot?.stats?.running_count || 0;
  const delay = running > 0 ? 2000 : 4000;
  state.pollTimer = setTimeout(() => {
    fetchSnapshot();
  }, delay);
}

function buildRenderSignature(snap) {
  if (!snap) return '';
  return JSON.stringify({
    scope: snap.scope,
    has_conversation: snap.has_conversation,
    subagent_count: snap.subagent_count,
    cli_status: snap.cli_status,
    stats: snap.stats,
    workers: (snap.workers || []).map((w) => ({
      ...w,
      elapsed_ms: w.status === 'running' ? 0 : w.elapsed_ms,
    })),
  });
}

async function fetchSnapshot({ forceRender = false } = {}) {
  if (state.pollingInFlight) return;
  state.pollingInFlight = true;
  let shouldRender = forceRender;
  try {
    const qs = new URLSearchParams({
      conversationId: getConversationId(),
      scope: state.scope,
      limit: '50',
    });
    const res = await doFetch(`/api/snapshot?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    state.snapshot = payload;
    state.snapshotReceivedMs = Date.now();
    state.lastError = null;
    const sig = buildRenderSignature(payload);
    if (sig !== state.lastRenderSignature) {
      state.lastRenderSignature = sig;
      shouldRender = true;
    }
  } catch (err) {
    state.lastError = String(err?.message || err || 'error');
    shouldRender = true;
  } finally {
    state.pollingInFlight = false;
    if (shouldRender) render();
    scheduleNextPoll();
  }
}

async function clearFinishedHistory() {
  if (state.pollingInFlight) return;
  state.pollingInFlight = true;
  try {
    const res = await doFetch('/api/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: getConversationId(),
        scope: state.scope,
        limit: 50,
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    state.snapshot = payload;
    state.snapshotReceivedMs = Date.now();
    state.lastError = null;
    state.lastRenderSignature = buildRenderSignature(payload);
  } catch (err) {
    state.lastError = String(err?.message || err || 'error');
  } finally {
    state.pollingInFlight = false;
    render();
    scheduleNextPoll();
  }
}

function syncThemeIfNeeded() {
  const nextTheme = detectThemeFromComputedBg();
  if (nextTheme !== state.theme) {
    state.theme = nextTheme;
    if (document.documentElement) {
      if (document.documentElement) {
  document.documentElement.setAttribute('data-theme', state.theme);
}
    }
    drawAllSprites();
  }
}

window.addEventListener('message', (ev) => {
  if (ev.data?.type === 'theme-change') {
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(fn, 0);
    raf(syncThemeIfNeeded);
  }
});

if (typeof MutationObserver === 'function' && document.documentElement) {
  new MutationObserver(() => {
    syncThemeIfNeeded();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
}

document.addEventListener('click', (ev) => {
  const target = ev.target;
  if (!target || typeof target.closest !== 'function') return;

  if (target.id === 'btn-refresh' || target.id === 'btn-retry') {
    fetchSnapshot({ forceRender: true });
    return;
  }
  if (target.id === 'btn-clear') {
    clearFinishedHistory();
    return;
  }
  if (target.id === 'btn-lang') {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    render();
    return;
  }

  const poseBtn = target.closest('[data-pose]');
  if (poseBtn) {
    const pose = poseBtn.getAttribute('data-pose');
    state.previewState = pose === 'live' ? null : pose;
    render();
    return;
  }

  const scopeBtn = target.closest('[data-scope]');
  if (scopeBtn) {
    const nextScope = scopeBtn.getAttribute('data-scope') === 'all' ? 'all' : 'conversation';
    if (nextScope !== state.scope) {
      state.scope = nextScope;
      fetchSnapshot({ forceRender: true });
    }
    return;
  }

  const statusBtn = target.closest('[data-status]');
  if (statusBtn) {
    state.statusFilter = statusBtn.getAttribute('data-status') || 'all';
    render();
    return;
  }

  if (target.id === 'workshop-canvas') {
    const rect = target.getBoundingClientRect();
    const cx = ev.clientX - rect.left;
    const cy = ev.clientY - rect.top;
    const hit = state.stageHitboxes.find(
      (b) => cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h
    );
    if (hit) {
      state.selectedWorkerId = hit.workerId;
      state.expandedIds.add(hit.workerId);
      render();
      if (typeof document.querySelector === 'function' && typeof CSS !== 'undefined') {
        const card = document.querySelector(`[data-worker-id="${CSS.escape(hit.workerId)}"]`);
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
    return;
  }

  const cardToggle = target.closest('[data-toggle-worker]');
  if (cardToggle) {
    const id = cardToggle.getAttribute('data-toggle-worker');
    if (id) {
      if (state.expandedIds.has(id)) state.expandedIds.delete(id);
      else state.expandedIds.add(id);
      state.selectedWorkerId = id;
      render();
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (state.pollTimer) {
      clearTimeout(state.pollTimer);
      state.pollTimer = null;
    }
  } else {
    fetchSnapshot();
  }
});

window.addEventListener('error', (ev) => {
  if (!window.__codexMonitorMounted) {
    renderBootError(ev?.error || ev?.message || 'Script error');
  }
});

window.addEventListener('unhandledrejection', (ev) => {
  if (!window.__codexMonitorMounted) {
    renderBootError(ev?.reason || 'Unhandled promise rejection');
  }
});

let lastAnimFrame = 0;
function animLoop(ts) {
  if (!document.hidden && ts - lastAnimFrame >= 110) {
    lastAnimFrame = ts;
    state.spriteTick += 1;
    drawAllSprites();
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(animLoop);
  }
}

setInterval(() => {
  if (!document.hidden) updateLiveTimers();
}, 1000);

render();
if (typeof requestAnimationFrame === 'function') {
  requestAnimationFrame(animLoop);
}
fetchSnapshot({ forceRender: true });
})();
