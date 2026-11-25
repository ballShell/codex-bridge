(() => {
  'use strict';

  const sprites = globalThis.CodexSprites || {};
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
  const STAGE_BADGE_MAP = sprites.STAGE_BADGE_MAP || {
    idle: { text: 'IDLE', bg: '#475569', fg: '#f8fafc' },
    thinking: { text: 'THINK', bg: '#d97706', fg: '#fffbeb' },
    coding: { text: 'CODE', bg: '#0891b2', fg: '#ecfeff' },
    reviewing: { text: 'REV', bg: '#7c3aed', fg: '#f5f3ff' },
    completed: { text: 'DONE', bg: '#059669', fg: '#ecfdf5' },
    failed: { text: 'FAIL', bg: '#dc2626', fg: '#fef2f2' },
  };
  const shortModelLabel =
    typeof sprites.shortModelLabel === 'function'
      ? sprites.shortModelLabel
      : (m) => {
          if (!m) return 'codex';
          const s = String(m).replace(/^gpt-/i, '');
          return s.length > 9 ? s.slice(0, 9) : s;
        };

  function getDragonGifUri(spriteState) {
    const map = globalThis.__CODEX_DRAGON_GIFS__;
    if (!map || typeof map !== 'object') return '';
    return map[spriteState] || map.idle || '';
  }

  function hasDragonGifs() {
    return Boolean(getDragonGifUri('idle'));
  }

  const I18N = {
    zh: {
      title: 'Codex Monitor',
      stageTitle: '像素工坊',
      stageStandby: '待命',
      stageRunning: (n) => `${n} 运行中`,
      statsTitle: '工作量统计',
      kpiActive: '运行中 / 总任务',
      kpiTokens: '累计 Token',
      kpiTime: '累计耗时',
      kpiFiles: '改动文件 / 成功率',
      cacheHit: '缓存命中',
      avgTime: '平均',
      doneShort: (n) => `${n} 完成`,
      failShort: (n) => `${n} 失败`,
      passedRatio: (c, t) => `${c}/${t} 通过`,
      noFinished: '暂无完结',
      defaultModelLabel: '插件默认模型',
      followCodex: '跟随 Codex',
      followShort: '跟随',
      modelIsolatedTip: '已启用插件独立默认模型（不影响全局 Codex CLI 配置）',
      modelFollowTip: '当前跟随本机 Codex CLI 默认模型，可在此切换为插件独立默认模型',
      scopeConv: '当前会话',
      scopeAll: '全部会话',
      cliReady: 'CLI 就绪',
      cliNotReady: 'CLI 未就绪',
      workersTitle: 'Codex 任务',
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
      filesCount: (n) => `${n} 文件`,
      sessionId: 'Codex 会话',
      convId: '所属对话',
      workdir: '工作目录',
      errorLabel: '异常原因',
      errorShowRaw: '查看原始错误日志',
      errorHideRaw: '收起原始错误日志',
      errorRetries: (n) => `重试 ${n} 次`,
      elapsedPrefix: '耗时',
      budgetLabel: '预设上限',
      budgetShort: (s) => `预设 ${s}`,
      softLabel: '软目标',
      idleLimitLabel: '静默上限',
      remainingPrefix: '剩',
      idlePrefix: '静默',
      doneCount: (c, f) => `${c} 完成 · ${f} 失败`,
      statusText: {
        running: '执行中',
        completed: '已完成',
        failed: '失败',
        timed_out: '已超时',
      },
      actText: {
        idle: '待命',
        starting: '启动中',
        thinking: '思考',
        coding: '执行',
        reviewing: '审查',
        completed: '已完成',
        failed: '异常',
        timed_out: '已超时',
      },
      unknownModel: '未知模型',
      defaultEffort: '默认',
    },
    en: {
      title: 'Codex Monitor',
      stageTitle: 'Pixel workshop',
      stageStandby: 'Standby',
      stageRunning: (n) => `${n} running`,
      statsTitle: 'Work statistics',
      kpiActive: 'Running / Total',
      kpiTokens: 'Total tokens',
      kpiTime: 'Total time',
      kpiFiles: 'Files / Success',
      cacheHit: 'Cache',
      avgTime: 'Avg',
      doneShort: (n) => `${n} done`,
      failShort: (n) => `${n} failed`,
      passedRatio: (c, t) => `${c}/${t} passed`,
      noFinished: 'No finished',
      defaultModelLabel: 'Plugin default model',
      followCodex: 'Follow Codex',
      followShort: 'Auto',
      modelIsolatedTip: 'Plugin-isolated default model (does not modify global Codex CLI config)',
      modelFollowTip: 'Following local Codex CLI default model; select a model here to isolate this plugin',
      scopeConv: 'This chat',
      scopeAll: 'All chats',
      cliReady: 'CLI Ready',
      cliNotReady: 'CLI Not Ready',
      workersTitle: 'Codex tasks',
      statusAll: 'All',
      statusRunning: 'Running',
      statusCompleted: 'Done',
      statusFailed: 'Failed',
      emptyTitleNoConv: 'No active conversation',
      emptyTitleNoWorkers: 'No Codex tasks in this chat',
      emptyTitleNoWorkersAll: 'No Codex tasks yet',
      emptyTitleFilter: 'No matching Codex tasks',
      errorBannerTitle: 'Monitor sync error',
      retryBtn: 'Retry',
      bootErrorTitle: 'Codex Monitor render error',
      loading: 'Loading conversation monitor…',
      connecting: 'Checking…',
      pollError: 'Sync failed',
      inputTok: 'Input',
      cachedTok: 'Cached',
      outputTok: 'Output',
      reasonTok: 'Reason',
      changedFiles: 'Files',
      filesCount: (n) => `${n} files`,
      sessionId: 'Session',
      convId: 'Chat ID',
      workdir: 'Workspace',
      errorLabel: 'Failure',
      errorShowRaw: 'View raw error log',
      errorHideRaw: 'Hide raw error log',
      errorRetries: (n) => `${n} retries`,
      elapsedPrefix: 'Elapsed',
      budgetLabel: 'Preset limit',
      budgetShort: (s) => `${s} limit`,
      softLabel: 'Soft target',
      idleLimitLabel: 'Idle limit',
      remainingPrefix: 'left',
      idlePrefix: 'idle',
      doneCount: (c, f) => `${c} done · ${f} failed`,
      statusText: {
        running: 'Running',
        completed: 'Done',
        failed: 'Failed',
        timed_out: 'Timed out',
      },
      actText: {
        idle: 'Idle',
        starting: 'Starting',
        thinking: 'Thinking',
        coding: 'Coding',
        reviewing: 'Reviewing',
        completed: 'Done',
        failed: 'Failed',
        timed_out: 'Timed out',
      },
      unknownModel: 'unknown',
      defaultEffort: 'default',
    },
  };

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
        probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--background, #fafafa)';
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
      settings: {
        default_model: null,
        effective_model: null,
        codex_default_model: null,
        source: 'codex',
        available_models: [],
      },
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
    selectedWorkerId: null,
    expandedIds: new Set(),
    expandedRawErrorIds: new Set(),
    pollingInFlight: false,
    savingSettings: false,
    modelMenuOpen: false,
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

  function formatBudgetSeconds(sec) {
    const totalSec = Math.max(0, Math.round(Number(sec || 0)));
    if (totalSec < 60) return `${totalSec}s`;
    if (totalSec < 3600 && totalSec % 60 === 0) return `${totalSec / 60}m`;
    if (totalSec % 3600 === 0) return `${totalSec / 3600}h`;
    return formatDurationMs(totalSec * 1000);
  }

  function computeLiveElapsedMs(worker) {
    const base = Number(worker.elapsed_ms || 0);
    if (worker.status !== 'running') return base;
    const delta = Math.max(0, Date.now() - state.snapshotReceivedMs);
    return base + delta;
  }

  function computeLiveRemainingMs(worker) {
    if (worker.status !== 'running' || typeof worker.max_duration_seconds !== 'number') return null;
    return Math.max(0, worker.max_duration_seconds * 1000 - computeLiveElapsedMs(worker));
  }

  function getFilteredWorkers() {
    const all = state.snapshot?.workers || [];
    return all.filter((w) => {
      if (state.statusFilter !== 'all' && w.status !== state.statusFilter) return false;
      return true;
    });
  }

  function shortenId(val) {
    const str = String(val || '').trim();
    if (str.length <= 18) return str;
    return `${str.slice(0, 8)}…${str.slice(-6)}`;
  }

  function shortenPath(val) {
    const str = String(val || '').trim();
    if (str.length <= 36) return str;
    const parts = str.split('/').filter(Boolean);
    if (parts.length <= 2) return str;
    return `…/${parts.slice(-2).join('/')}`;
  }

  function stripHtmlTags(str) {
    return String(str || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function summarizeWorkerError(rawError, worker, lang) {
    const raw = String(rawError || '').trim();
    const isZh = lang !== 'en';
    const isTimedOut = Boolean(worker?.timed_out || worker?.activity === 'timed_out');

    if (isTimedOut) {
      const reason = worker?.timeout_reason || '';
      if (reason === 'max_idle') {
        const lim =
          typeof worker.max_idle_seconds === 'number' && worker.max_idle_seconds > 0
            ? formatBudgetSeconds(worker.max_idle_seconds)
            : '';
        return {
          badge: isZh ? '静默超时' : 'Idle timeout',
          title: isZh ? '长时间无响应，已自动终止' : 'Terminated after idle stall',
          detail: isZh
            ? lim
              ? `连续 ${lim} 未收到新进展事件`
              : '超过预设静默上限未收到新进展'
            : lim
              ? `No progress events for ${lim}`
              : 'Exceeded preset idle stall limit',
          hint: isZh
            ? '可能因上游模型响应卡住，可重试或调高静默上限。'
            : 'Upstream may have stalled; retry or increase max_idle_seconds.',
          shortText: isZh
            ? lim
              ? `静默超时 (${lim})`
              : '静默超时已终止'
            : lim
              ? `Idle timeout (${lim})`
              : 'Idle timeout',
          retries: 0,
          raw,
        };
      }
      const lim =
        typeof worker?.max_duration_seconds === 'number' && worker.max_duration_seconds > 0
          ? formatBudgetSeconds(worker.max_duration_seconds)
          : '';
      return {
        badge: isZh ? '超时终止' : 'Timed out',
        title: isZh ? '超出预设执行时长上限' : 'Reached preset duration limit',
        detail: isZh
          ? lim
            ? `已达到预设时长上限 ${lim}，看门狗已安全结束进程`
            : '已达到预设执行时长上限，进程已安全结束'
          : lim
            ? `Hit preset wall-clock limit (${lim}); watchdog terminated the process`
            : 'Reached preset wall-clock limit',
        hint: isZh
          ? '可缩小任务范围，或调高预设时长后继续执行。'
          : 'Narrow task scope or increase max_duration_seconds to resume.',
        shortText: isZh
          ? lim
            ? `超出预设时长 ${lim}`
            : '超出预设时长已终止'
          : lim
            ? `Hit ${lim} limit`
            : 'Duration limit reached',
        retries: 0,
        raw,
      };
    }

    if (!raw) return null;

    let maxRetry = 0;
    const retryRe = /Reconnecting\.\.\.\s*(\d+)\s*\/\s*(\d+)/gi;
    let m;
    while ((m = retryRe.exec(raw)) !== null) {
      const attempt = Number(m[1]);
      if (Number.isFinite(attempt) && attempt > maxRetry) maxRetry = attempt;
    }

    const urlMatch = raw.match(/\burl:\s*(https?:\/\/[^\s),]+)/i) || raw.match(/(https?:\/\/[^\s),]+)/i);
    const endpointUrl = urlMatch ? urlMatch[1] : '';
    let endpointHost = '';
    if (endpointUrl) {
      const hostMatch = endpointUrl.match(/^https?:\/\/([^/?#]+)/i);
      endpointHost = hostMatch ? hostMatch[1] : endpointUrl;
    }

    const statusMatch =
      raw.match(/unexpected status\s+(\d{3})(?:\s+([A-Za-z][A-Za-z -]{1,32}))?/i) ||
      raw.match(/\bHTTP\s+(\d{3})(?:\s+([A-Za-z][A-Za-z -]{1,32}))?/i);
    if (statusMatch) {
      const code = Number(statusMatch[1]);
      const reasonText = (statusMatch[2] || '').trim();
      const statusLabel = reasonText ? `${code} ${reasonText}` : `HTTP ${code}`;
      let title;
      let hint;
      if (code === 404) {
        title = isZh ? `上游接口返回 ${statusLabel}` : `Upstream returned ${statusLabel}`;
        hint = isZh
          ? '中转站节点异常或接口路径不可用，请检查服务商状态或切换模型后重试。'
          : 'Relay endpoint not found or unstable; check provider status or switch model.';
      } else if (code === 401 || code === 403) {
        title = isZh ? `接口鉴权失败 (${statusLabel})` : `Authentication failed (${statusLabel})`;
        hint = isZh
          ? '请检查 API Key、登录态或当前账号的接口访问权限。'
          : 'Verify your API key, Codex login session, or provider permissions.';
      } else if (code === 429) {
        title = isZh ? `上游接口触发限流 (${statusLabel})` : `Rate limited (${statusLabel})`;
        hint = isZh
          ? '请求频率过高或额度不足，请稍后重试。'
          : 'Too many requests or quota exhausted; retry shortly.';
      } else if (code >= 500) {
        title = isZh ? `上游服务异常 (${statusLabel})` : `Upstream service error (${statusLabel})`;
        hint = isZh
          ? '模型服务端或中转网关暂时不可用，请稍后重试。'
          : 'Provider or gateway is temporarily unavailable; retry later.';
      } else {
        title = isZh ? `上游接口报错 (${statusLabel})` : `Upstream request error (${statusLabel})`;
        hint = isZh
          ? '可展开下方原始错误日志排查具体原因。'
          : 'Expand raw error log below for full details.';
      }

      const shortParts = [isZh ? `上游 ${code}` : `HTTP ${code}`];
      if (endpointHost) shortParts.push(endpointHost);
      return {
        badge: `HTTP ${code}`,
        title,
        detail: endpointUrl || '',
        hint,
        shortText: shortParts.join(' · '),
        retries: maxRetry,
        raw,
      };
    }

    if (
      /econnrefused|econnreset|etimedout|connection refused|connection reset|stream disconnected|broken pipe|tls|certificate|dns|fetch failed/i.test(
        raw
      )
    ) {
      const cleaned = stripHtmlTags(raw)
        .replace(/Reading additional input from stdin\.{0,3}/gi, '')
        .replace(/Reconnecting\.\.\.\s*\d+\/\d+\s*/gi, '')
        .trim();
      const firstLine = cleaned.split(/\r?\n/)[0]?.slice(0, 120) || '';
      return {
        badge: isZh ? '网络异常' : 'Network',
        title: isZh ? '上游网络连接中断' : 'Upstream connection interrupted',
        detail: endpointUrl || firstLine,
        hint: isZh
          ? '网络波动或代理/中转连接断开，请检查网络与服务商可用性。'
          : 'Network or relay connection dropped; check connectivity and retry.',
        shortText: endpointHost
          ? `${isZh ? '连接中断' : 'Connection lost'} · ${endpointHost}`
          : isZh
            ? '上游连接中断'
            : 'Connection lost',
        retries: maxRetry,
        raw,
      };
    }

    const cleanedLines = raw
      .split(/\r?\n/)
      .map((line) => stripHtmlTags(line).replace(/^Reconnecting\.\.\.\s*\d+\/\d+\s*/i, '').trim())
      .filter((line) => line && !/^Reading additional input from stdin/i.test(line));
    const uniqueLines = Array.from(new Set(cleanedLines));
    const primary = (uniqueLines[uniqueLines.length - 1] || stripHtmlTags(raw)).slice(0, 140);
    return {
      badge: isZh ? '执行失败' : 'Failed',
      title: isZh ? 'Codex 执行过程中出错' : 'Codex execution failed',
      detail: primary,
      hint: isZh ? '可展开下方原始日志查看完整上下文。' : 'Expand raw error log below for details.',
      shortText: primary.slice(0, 72),
      retries: maxRetry,
      raw,
    };
  }

  function renderStatsSection(snap, tr) {
    const stats = snap?.stats || {};
    const tok = stats.tokens || {};
    const running = stats.running_count || 0;
    const total = stats.total_workers || 0;
    const completed = stats.completed_count || 0;
    const failed = stats.failed_count || 0;
    const finished = completed + failed;
    const inTok = tok.input_tokens || 0;
    const cacheTok = tok.cached_input_tokens || 0;
    const outTok = tok.output_tokens || 0;
    const reasonTok = tok.reasoning_output_tokens || 0;
    const totTok = tok.total_tokens || 0;
    const cacheRatePct = Math.round((tok.cache_hit_rate || 0) * 100);
    const successRate = stats.success_rate || 0;
    const successRatePct = finished > 0 ? `${Math.round(successRate * 100)}%` : '—';
    const passDotClass =
      finished === 0 ? '' : successRate >= 0.8 ? 'is-ok' : successRate >= 0.5 ? 'is-warn' : 'is-err';
    const tokTooltip = `${tr.cachedTok}: ${formatNumber(cacheTok)} (${cacheRatePct}%) | ${tr.inputTok}: ${formatNumber(inTok)} | ${tr.outputTok}: ${formatNumber(outTok)}${reasonTok > 0 ? ` | ${tr.reasonTok}: ${formatNumber(reasonTok)}` : ''}`;

    return `
      <section class="section">
        <div class="section-head">
          <h2 class="section-title">${escapeHtml(tr.statsTitle)}</h2>
        </div>
        <div class="kpi-grid">
          <div class="kpi-item">
            <div class="kpi-label">${escapeHtml(tr.kpiActive)}</div>
            <div class="kpi-value num">${running} / ${total}</div>
            <div class="kpi-chips num">
              <span class="kpi-pill"><span class="kpi-dot ${completed > 0 ? 'is-ok' : ''}" aria-hidden="true"></span><span>${escapeHtml(tr.doneShort(completed))}</span></span>
              <span class="kpi-pill"><span class="kpi-dot ${failed > 0 ? 'is-err' : ''}" aria-hidden="true"></span><span>${escapeHtml(tr.failShort(failed))}</span></span>
            </div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">${escapeHtml(tr.kpiTokens)}</div>
            <div class="kpi-value num">${formatNumber(totTok)}</div>
            <div class="kpi-chips num">
              <span class="kpi-pill" title="${escapeHtml(tokTooltip)}"><span class="kpi-dot ${cacheRatePct > 0 ? 'is-ok' : ''}" aria-hidden="true"></span><span>${escapeHtml(tr.cachedTok)} ${cacheRatePct}%</span></span>
            </div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">${escapeHtml(tr.kpiTime)}</div>
            <div class="kpi-value num">${formatDurationMs(stats.total_elapsed_ms)}</div>
            <div class="kpi-chips num">
              <span class="kpi-pill"><span class="kpi-dot ${stats.avg_elapsed_ms > 0 ? 'is-accent' : ''}" aria-hidden="true"></span><span>${escapeHtml(tr.avgTime)} ${formatDurationMs(stats.avg_elapsed_ms)}</span></span>
            </div>
          </div>
          <div class="kpi-item">
            <div class="kpi-label">${escapeHtml(tr.kpiFiles)}</div>
            <div class="kpi-value num">${stats.total_changed_files || 0} / ${successRatePct}</div>
            <div class="kpi-chips num">
              <span class="kpi-pill"><span class="kpi-dot ${passDotClass}" aria-hidden="true"></span><span>${escapeHtml(finished > 0 ? tr.passedRatio(completed, finished) : tr.noFinished)}</span></span>
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderWorkshopStageHtml(workers, tr) {
    if (!hasDragonGifs()) {
      return `<canvas id="workshop-canvas" aria-label="${escapeHtml(tr.stageTitle)}"></canvas>`;
    }

    const list = Array.isArray(workers) ? workers : [];
    const running = list.filter((w) => w.status === 'running');
    let cast;
    if (running.length > 0) {
      cast = running.slice(0, 4);
    } else if (list.length > 0) {
      cast = list.slice(0, Math.min(3, list.length));
    } else {
      cast = [
        {
          worker_id: '__standby__',
          model: 'codex',
          status: 'idle',
          activity: 'idle',
          _forcedState: 'idle',
        },
      ];
    }

    const slotsHtml = cast
      .map((worker) => {
        const spriteState = worker._forcedState || resolveSpriteState(worker);
        const gifSrc = getDragonGifUri(spriteState);
        const badge = STAGE_BADGE_MAP[spriteState] || STAGE_BADGE_MAP.idle;
        const labelText = `${badge.text} ${shortModelLabel(worker.model)}`;
        const isReal = Boolean(worker.worker_id && !String(worker.worker_id).startsWith('__'));
        const isSelected = Boolean(isReal && state.selectedWorkerId === worker.worker_id);
        const inner = `
          <span class="stage-dragon-wrap" aria-hidden="true">
            <img class="stage-dragon" src="${gifSrc}" alt="" width="90" height="96" data-dragon-state="${escapeHtml(spriteState)}" />
          </span>
          <span class="stage-badge" style="background:${badge.bg};color:${badge.fg}">${escapeHtml(labelText)}</span>
        `;
        if (isReal) {
          const tip = worker.prompt_preview || worker.model || worker.worker_id;
          return `<button type="button" class="stage-slot ${isSelected ? 'is-selected' : ''}" data-stage-worker="${escapeHtml(worker.worker_id)}" title="${escapeHtml(tip)}">${inner}</button>`;
        }
        return `<div class="stage-slot is-standby">${inner}</div>`;
      })
      .join('');

    return `
      <div class="workshop-stage" id="workshop-stage" role="region" aria-label="${escapeHtml(tr.stageTitle)}">
        <div class="stage-window" aria-hidden="true"></div>
        <div class="stage-floor" aria-hidden="true"></div>
        <div class="stage-cast">${slotsHtml}</div>
      </div>
    `;
  }

  function renderWorkerCard(worker, _idx, tr) {
    const id = worker.worker_id;
    const status = worker.status || 'completed';
    const isTimedOut = Boolean(worker.timed_out || worker.activity === 'timed_out');
    const visualState = isTimedOut ? 'timed_out' : status;
    const spriteState = resolveSpriteState(worker);
    const dragonGif = getDragonGifUri(spriteState);
    const effort = worker.reasoning_effort || tr.defaultEffort;
    const model = worker.model || tr.unknownModel;
    const modeLabel = worker.mode || 'exec';
    const expanded = state.expandedIds.has(id);
    const rawErrOpen = state.expandedRawErrorIds.has(id);
    const selected = state.selectedWorkerId === id;

    const usage = worker.usage || {};
    const inTok = usage.input_tokens || 0;
    const cacheTok = usage.cached_input_tokens || 0;
    const uncachedIn = Math.max(0, inTok - cacheTok);
    const outTok = usage.output_tokens || 0;
    const reasonTok = usage.reasoning_output_tokens || 0;
    const totTok = usage.total_tokens || 0;
    const barDenom = Math.max(1, cacheTok + uncachedIn + outTok);

    const statusLabel = isTimedOut
      ? tr.statusText.timed_out
      : (tr.statusText[status] || status);

    const previewText = worker.prompt_preview || worker.cwd || worker.session_id || id;
    const changed = Array.isArray(worker.changed_files) ? worker.changed_files : [];

    const liveElapsed = formatDurationMs(computeLiveElapsedMs(worker));
    const hasBudget = typeof worker.max_duration_seconds === 'number' && worker.max_duration_seconds > 0;
    const budgetText = hasBudget ? formatBudgetSeconds(worker.max_duration_seconds) : '';
    const softText =
      typeof worker.soft_budget_seconds === 'number' && worker.soft_budget_seconds > 0
        ? formatBudgetSeconds(worker.soft_budget_seconds)
        : '';
    const idleLimitText =
      typeof worker.max_idle_seconds === 'number' && worker.max_idle_seconds > 0
        ? formatBudgetSeconds(worker.max_idle_seconds)
        : '';
    const remMs = computeLiveRemainingMs(worker);

    const errInfo =
      worker.error || isTimedOut ? summarizeWorkerError(worker.error, worker, state.lang) : null;

    const timingRightParts = [];
    if (status === 'running' && remMs !== null) {
      const lowRem = hasBudget && remMs <= worker.max_duration_seconds * 1000 * 0.2;
      timingRightParts.push(
        `<span class="live-remaining num${lowRem ? ' is-warn' : ''}" data-remaining-worker="${escapeHtml(id)}">${escapeHtml(tr.remainingPrefix)} ${formatDurationMs(remMs)}</span>`
      );
    } else if (status === 'running' && typeof worker.idle_ms === 'number' && worker.idle_ms >= 30000) {
      timingRightParts.push(
        `<span class="timing-idle num">${escapeHtml(tr.idlePrefix)} ${formatDurationMs(worker.idle_ms)}</span>`
      );
    } else if (changed.length > 0) {
      timingRightParts.push(`<span class="timing-files num">${escapeHtml(tr.filesCount(changed.length))}</span>`);
    }

    const budgetCells = [];
    if (hasBudget) {
      budgetCells.push({ label: tr.budgetLabel, value: budgetText });
      if (softText) budgetCells.push({ label: tr.softLabel, value: softText });
      if (idleLimitText) budgetCells.push({ label: tr.idleLimitLabel, value: idleLimitText });
    }

    const kvRows = [];
    if (worker.cwd) {
      kvRows.push({
        label: tr.workdir,
        value: shortenPath(worker.cwd),
        title: worker.cwd,
      });
    }
    if (worker.session_id) {
      kvRows.push({
        label: tr.sessionId,
        value: shortenId(worker.session_id),
        title: worker.session_id,
      });
    }
    if (worker.conversation_id) {
      kvRows.push({
        label: tr.convId,
        value: shortenId(worker.conversation_id),
        title: worker.conversation_id,
      });
    }
    if (changed.length > 0) {
      kvRows.push({
        label: `${tr.changedFiles} (${changed.length})`,
        value: changed.join(', '),
        title: changed.join('\n'),
      });
    }

    return `
      <article class="worker-card ${escapeHtml(visualState)} ${selected ? 'selected' : ''} ${expanded ? 'is-expanded' : ''}" data-worker-id="${escapeHtml(id)}">
        <button type="button" class="worker-toggle" data-toggle-worker="${escapeHtml(id)}" aria-expanded="${expanded ? 'true' : 'false'}">
          <span class="sprite-slot" aria-hidden="true">
            ${
              dragonGif
                ? `<img class="worker-dragon" src="${dragonGif}" alt="" width="64" height="68" data-dragon-worker="${escapeHtml(id)}" data-dragon-state="${escapeHtml(spriteState)}" />`
                : `<canvas class="worker-sprite" width="40" height="40" data-sprite-worker="${escapeHtml(id)}"></canvas>`
            }
          </span>
          <span class="worker-body">
            <span class="worker-top-row">
              <span class="worker-title-wrap">
                <span class="status-dot ${escapeHtml(visualState)}" aria-hidden="true"></span>
                <span class="worker-preview" title="${escapeHtml(previewText)}">${escapeHtml(previewText)}</span>
              </span>
              <span class="status-text ${escapeHtml(visualState)}">${escapeHtml(statusLabel)}</span>
            </span>
            <span class="worker-tags-row">
              <span class="worker-tags">
                <span class="meta-tag" title="${escapeHtml(model)}">${escapeHtml(model)}</span>
                <span class="meta-tag" title="${escapeHtml(effort)}">${escapeHtml(effort)}</span>
                <span class="meta-tag" title="${escapeHtml(modeLabel)}">${escapeHtml(modeLabel)}</span>
              </span>
              ${totTok > 0 ? `<span class="worker-tokens num">${formatNumber(totTok)}</span>` : ''}
            </span>
            <span class="worker-timing-row">
              <span class="worker-timing-left">
                <span class="timing-item">${escapeHtml(tr.elapsedPrefix)} <span class="live-elapsed num" data-elapsed-worker="${escapeHtml(id)}">${liveElapsed}</span></span>
                ${hasBudget ? `<span class="timing-sep" aria-hidden="true">·</span><span class="worker-budget num" data-budget-worker="${escapeHtml(id)}">${escapeHtml(tr.budgetShort(budgetText))}</span>` : ''}
              </span>
              ${timingRightParts.length > 0 ? `<span class="worker-timing-right">${timingRightParts.join('')}</span>` : ''}
            </span>
            ${
              errInfo && !expanded
                ? `
              <span class="worker-err-preview">
                <span class="worker-err-badge">${escapeHtml(errInfo.badge)}</span>
                <span class="worker-err-text" title="${escapeHtml(errInfo.title)}">${escapeHtml(errInfo.shortText)}${errInfo.retries > 0 ? ` · ${escapeHtml(tr.errorRetries(errInfo.retries))}` : ''}</span>
              </span>
            `
                : ''
            }
          </span>
        </button>
        ${
          expanded
            ? `
          <div class="worker-details">
            ${
              errInfo
                ? `
              <div class="error-callout ${isTimedOut ? 'is-warn' : ''}">
                <div class="error-callout-head">
                  <span class="error-callout-title">${escapeHtml(errInfo.title)}</span>
                  ${errInfo.retries > 0 ? `<span class="error-callout-pill num">${escapeHtml(tr.errorRetries(errInfo.retries))}</span>` : ''}
                </div>
                ${errInfo.detail ? `<div class="error-callout-detail" title="${escapeHtml(errInfo.detail)}">${escapeHtml(errInfo.detail)}</div>` : ''}
                ${errInfo.hint ? `<div class="error-callout-hint">${escapeHtml(errInfo.hint)}</div>` : ''}
                ${
                  errInfo.raw
                    ? `
                  <div class="error-raw-wrap">
                    <button type="button" class="error-raw-toggle" data-toggle-raw-error="${escapeHtml(id)}" aria-expanded="${rawErrOpen ? 'true' : 'false'}">${escapeHtml(rawErrOpen ? tr.errorHideRaw : tr.errorShowRaw)}</button>
                    ${rawErrOpen ? `<pre class="error-raw-pre" data-raw-error-worker="${escapeHtml(id)}">${escapeHtml(errInfo.raw)}</pre>` : ''}
                  </div>
                `
                    : ''
                }
              </div>
            `
                : ''
            }
            <div class="detail-panel">
              ${
                totTok > 0
                  ? `
                <div class="token-strip" aria-hidden="true" title="${escapeHtml(tr.cachedTok)}: ${formatNumber(cacheTok)} | ${escapeHtml(tr.inputTok)}: ${formatNumber(inTok)} | ${escapeHtml(tr.outputTok)}: ${formatNumber(outTok)}">
                  <div class="tok-cached" style="width:${(cacheTok / barDenom) * 100}%"></div>
                  <div class="tok-uncached" style="width:${(uncachedIn / barDenom) * 100}%"></div>
                  <div class="tok-output" style="width:${(outTok / barDenom) * 100}%"></div>
                </div>
              `
                  : ''
              }
              <div class="detail-metrics detail-metrics-4">
                <div class="detail-metric">
                  <span class="detail-metric-label">${escapeHtml(tr.inputTok)}</span>
                  <span class="detail-metric-val num">${formatNumber(inTok)}</span>
                </div>
                <div class="detail-metric">
                  <span class="detail-metric-label">${escapeHtml(tr.cachedTok)}</span>
                  <span class="detail-metric-val num">${formatNumber(cacheTok)}</span>
                </div>
                <div class="detail-metric">
                  <span class="detail-metric-label">${escapeHtml(tr.outputTok)}</span>
                  <span class="detail-metric-val num">${formatNumber(outTok)}</span>
                </div>
                <div class="detail-metric">
                  <span class="detail-metric-label">${escapeHtml(tr.reasonTok)}</span>
                  <span class="detail-metric-val num">${formatNumber(reasonTok)}</span>
                </div>
              </div>
            </div>
            ${
              budgetCells.length > 0
                ? `
              <div class="detail-panel">
                <div class="detail-metrics detail-metrics-${budgetCells.length}">
                  ${budgetCells
                    .map(
                      (c) => `
                    <div class="detail-metric">
                      <span class="detail-metric-label">${escapeHtml(c.label)}</span>
                      <span class="detail-metric-val num">${escapeHtml(c.value)}</span>
                    </div>
                  `
                    )
                    .join('')}
                </div>
              </div>
            `
                : ''
            }
            ${
              kvRows.length > 0
                ? `
              <dl class="detail-kv">
                ${kvRows
                  .map(
                    (row) => `
                  <dt class="detail-kv-k">${escapeHtml(row.label)}</dt>
                  <dd class="detail-kv-v" title="${escapeHtml(row.title)}">${escapeHtml(row.value)}</dd>
                `
                  )
                  .join('')}
              </dl>
            `
                : ''
            }
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

  function captureFocusSelector() {
    try {
      const active = document.activeElement;
      if (!active || typeof active.getAttribute !== 'function') return null;
      const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape : (s) => String(s);
      if (typeof active.hasAttribute === 'function' && active.hasAttribute('data-select-model')) {
        const val = active.getAttribute('data-select-model') || '';
        return `[data-select-model="${esc(val)}"]`;
      }
      for (const attr of ['data-toggle-raw-error', 'data-toggle-worker', 'data-scope', 'data-status']) {
        const val = active.getAttribute(attr);
        if (val) return `[${attr}="${esc(val)}"]`;
      }
      if (active.id && (active.id === 'btn-lang' || active.id === 'btn-retry' || active.id === 'btn-model-picker')) {
        return `#${esc(active.id)}`;
      }
    } catch {
      // ignore focus capture errors in minimal environments
    }
    return null;
  }

  function restoreFocusSelector(selector) {
    if (!selector || typeof document.querySelector !== 'function') return;
    try {
      const el = document.querySelector(selector);
      if (el && typeof el.focus === 'function') {
        el.focus({ preventScroll: true });
      }
    } catch {
      // ignore focus restore errors
    }
  }

  function captureRawErrorScrolls() {
    const scrolls = new Map();
    if (typeof document.querySelectorAll !== 'function') return scrolls;
    try {
      document.querySelectorAll('[data-raw-error-worker]').forEach((el) => {
        const id = el.getAttribute('data-raw-error-worker');
        if (id && typeof el.scrollTop === 'number') {
          scrolls.set(id, el.scrollTop);
        }
      });
    } catch {
      // ignore
    }
    return scrolls;
  }

  function restoreRawErrorScrolls(scrolls) {
    if (!scrolls || scrolls.size === 0 || typeof document.querySelectorAll !== 'function') return;
    try {
      document.querySelectorAll('[data-raw-error-worker]').forEach((el) => {
        const id = el.getAttribute('data-raw-error-worker');
        if (id && scrolls.has(id)) {
          el.scrollTop = scrolls.get(id);
        }
      });
    } catch {
      // ignore
    }
  }

  function render({ focusSelector = null } = {}) {
    const root = document.getElementById('app');
    if (!root) return;
    try {
      const targetFocus = focusSelector || captureFocusSelector();
      const savedScrolls = captureRawErrorScrolls();
      const tr = t();
      const hasLoaded = Boolean(state.snapshot);
      const snap = state.snapshot || makeEmptySnapshot();
      const cli = snap.cli_status || {};
      const settings = snap.settings || {};
      const runningCount = snap.stats?.running_count || 0;

      const cliReady = Boolean(cli.binary_found && cli.auth_ready);
      const cliStatusText = hasLoaded ? (cliReady ? tr.cliReady : tr.cliNotReady) : tr.connecting;
      const dotClass = runningCount > 0 ? 'active' : hasLoaded ? (cliReady ? 'ready' : 'warn') : '';

      const codexDefaultModel = settings.codex_default_model || cli.codex_default_model || cli.default_model || '';
      const pluginDefaultModel = settings.default_model || '';
      const isIsolatedModel = Boolean(pluginDefaultModel);
      const availableModels = Array.isArray(settings.available_models) ? settings.available_models : [];
      const optionSeen = new Set();
      const modelOptions = [];
      for (const item of availableModels) {
        if (!item || typeof item.id !== 'string' || !item.id.trim()) continue;
        const mid = item.id.trim();
        if (optionSeen.has(mid)) continue;
        optionSeen.add(mid);
        modelOptions.push({ id: mid, label: item.label || mid });
      }
      if (codexDefaultModel && !optionSeen.has(codexDefaultModel)) {
        optionSeen.add(codexDefaultModel);
        modelOptions.push({ id: codexDefaultModel, label: codexDefaultModel });
      }
      if (pluginDefaultModel && !optionSeen.has(pluginDefaultModel)) {
        optionSeen.add(pluginDefaultModel);
        modelOptions.push({ id: pluginDefaultModel, label: pluginDefaultModel });
      }
      const followLabel = codexDefaultModel ? `${tr.followCodex} (${codexDefaultModel})` : tr.followCodex;
      const triggerLabel =
        pluginDefaultModel || (codexDefaultModel ? `${tr.followShort} · ${codexDefaultModel}` : tr.followCodex);
      const pickerTip = isIsolatedModel ? tr.modelIsolatedTip : tr.modelFollowTip;
      const checkSvg =
        '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6.2L5 8.6L9.5 3.6"/></svg>';
      const chevronSvg =
        '<svg class="model-trigger-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5L6 7.5L9 4.5"/></svg>';
      const modelPickerHtml = hasLoaded
        ? `
          <div class="model-picker ${state.modelMenuOpen ? 'is-open' : ''}" id="model-picker">
            <button
              type="button"
              id="btn-model-picker"
              class="model-trigger ${isIsolatedModel ? 'is-isolated' : ''}"
              aria-haspopup="listbox"
              aria-expanded="${state.modelMenuOpen ? 'true' : 'false'}"
              aria-label="${escapeHtml(tr.defaultModelLabel)}"
              title="${escapeHtml(pickerTip)}"${state.savingSettings ? ' disabled' : ''}
            >
              ${isIsolatedModel ? '<span class="model-trigger-dot" aria-hidden="true"></span>' : ''}
              <span class="model-trigger-text">${escapeHtml(triggerLabel)}</span>
              ${chevronSvg}
            </button>
            ${
              state.modelMenuOpen
                ? `
              <div class="model-menu" role="listbox" aria-label="${escapeHtml(tr.defaultModelLabel)}">
                <button type="button" class="model-option ${!pluginDefaultModel ? 'is-selected' : ''}" role="option" aria-selected="${!pluginDefaultModel ? 'true' : 'false'}" data-select-model="">
                  <span class="model-opt-check" aria-hidden="true">${!pluginDefaultModel ? checkSvg : ''}</span>
                  <span class="model-opt-label">${escapeHtml(followLabel)}</span>
                </button>
                ${modelOptions.length > 0 ? '<div class="model-menu-sep" role="separator"></div>' : ''}
                ${modelOptions
                  .map(
                    (m) => `
                  <button type="button" class="model-option ${pluginDefaultModel === m.id ? 'is-selected' : ''}" role="option" aria-selected="${pluginDefaultModel === m.id ? 'true' : 'false'}" data-select-model="${escapeHtml(m.id)}">
                    <span class="model-opt-check" aria-hidden="true">${pluginDefaultModel === m.id ? checkSvg : ''}</span>
                    <span class="model-opt-label">${escapeHtml(m.label)}</span>
                  </button>
                `
                  )
                  .join('')}
              </div>
            `
                : ''
            }
          </div>
        `
        : '';

      const totalInSnap = (snap.workers || []).length;
      const filtered = getFilteredWorkers();

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
            <div class="title-row">
              <span class="live-dot ${dotClass}" aria-hidden="true"></span>
              <h1 class="title-text">${escapeHtml(tr.title)}</h1>
              <span class="cli-status ${hasLoaded && !cliReady ? 'warn' : ''}">${escapeHtml(cliStatusText)}</span>
            </div>
            <div class="controls">
              <button type="button" class="btn" id="btn-lang">${state.lang === 'zh' ? 'EN' : '中文'}</button>
            </div>
          </header>

          ${
            state.lastError
              ? `
            <div class="error-banner" role="alert">
              <div>
                <strong>${escapeHtml(tr.errorBannerTitle)}</strong>
                <span> · ${escapeHtml(state.lastError)}</span>
              </div>
              <button type="button" class="btn" id="btn-retry"${state.pollingInFlight ? ' disabled' : ''}>${escapeHtml(tr.retryBtn)}</button>
            </div>
          `
              : ''
          }

          <main class="section section-first">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(tr.stageTitle)}</h2>
              <span class="section-meta ${runningCount > 0 ? 'is-live' : ''}">${escapeHtml(runningCount > 0 ? tr.stageRunning(runningCount) : tr.stageStandby)}</span>
            </div>
            <div class="stage-wrap">
              ${renderWorkshopStageHtml(snap.workers || [], tr)}
            </div>
          </main>

          ${renderStatsSection(snap, tr)}

          <section class="section">
            <div class="section-head">
              <h2 class="section-title">${escapeHtml(tr.workersTitle)} <span class="num">(${filtered.length})</span></h2>
              ${modelPickerHtml}
            </div>
            <div class="toolbar">
              <div class="tab-group" role="group" aria-label="Scope">
                ${['conversation', 'all']
                  .map((sc) => {
                    const label = sc === 'conversation' ? tr.scopeConv : tr.scopeAll;
                    const active = state.scope === sc;
                    return `<button type="button" class="tab-btn ${active ? 'active' : ''}" data-scope="${sc}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
                  })
                  .join('')}
              </div>
              <div class="tab-group" role="group" aria-label="Status">
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
                    const active = state.statusFilter === st;
                    return `<button type="button" class="tab-btn ${active ? 'active' : ''}" data-status="${st}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(label)}</button>`;
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
      restoreRawErrorScrolls(savedScrolls);
      restoreFocusSelector(targetFocus);
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
    const tr = t();
    const workers = state.snapshot?.workers || [];
    const byId = new Map(workers.map((w) => [w.worker_id, w]));
    document.querySelectorAll('[data-elapsed-worker]').forEach((el) => {
      const id = el.getAttribute('data-elapsed-worker');
      const worker = id ? byId.get(id) : null;
      if (worker && worker.status === 'running') {
        el.textContent = formatDurationMs(computeLiveElapsedMs(worker));
      }
    });
    document.querySelectorAll('[data-remaining-worker]').forEach((el) => {
      const id = el.getAttribute('data-remaining-worker');
      const worker = id ? byId.get(id) : null;
      if (worker && worker.status === 'running') {
        const rem = computeLiveRemainingMs(worker);
        if (rem !== null) {
          el.textContent = `${tr.remainingPrefix} ${formatDurationMs(rem)}`;
          if (el.classList && typeof worker.max_duration_seconds === 'number' && worker.max_duration_seconds > 0) {
            el.classList.toggle('is-warn', rem <= worker.max_duration_seconds * 1000 * 0.2);
          }
        }
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
      settings: snap.settings,
      stats: snap.stats,
      workers: (snap.workers || []).map((w) => ({
        ...w,
        elapsed_ms: w.status === 'running' ? 0 : w.elapsed_ms,
        remaining_ms: w.status === 'running' ? 0 : w.remaining_ms,
        idle_ms:
          w.status === 'running'
            ? typeof w.idle_ms === 'number' && w.idle_ms >= 30000
              ? Math.floor(w.idle_ms / 1000)
              : 0
            : w.idle_ms,
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

  async function updateDefaultModel(nextModel) {
    if (state.savingSettings) return;
    state.modelMenuOpen = false;
    state.savingSettings = true;
    render({ focusSelector: '#btn-model-picker' });
    try {
      const res = await doFetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_model: nextModel || null,
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
      state.savingSettings = false;
      render({ focusSelector: '#btn-model-picker' });
      scheduleNextPoll();
    }
  }

  function syncThemeIfNeeded() {
    const nextTheme = detectThemeFromComputedBg();
    if (nextTheme !== state.theme) {
      state.theme = nextTheme;
      if (document.documentElement) {
        document.documentElement.setAttribute('data-theme', state.theme);
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

  document.addEventListener('keydown', (ev) => {
    if (!state.modelMenuOpen) return;
    if (ev.key === 'Escape') {
      state.modelMenuOpen = false;
      render({ focusSelector: '#btn-model-picker' });
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      if (typeof document.querySelectorAll !== 'function') return;
      const items = Array.from(document.querySelectorAll('[data-select-model]'));
      if (items.length === 0) return;
      if (typeof ev.preventDefault === 'function') ev.preventDefault();
      const idx = items.indexOf(document.activeElement);
      const nextIdx =
        idx === -1
          ? ev.key === 'ArrowDown'
            ? 0
            : items.length - 1
          : ev.key === 'ArrowDown'
            ? (idx + 1) % items.length
            : (idx - 1 + items.length) % items.length;
      if (typeof items[nextIdx]?.focus === 'function') items[nextIdx].focus();
    }
  });

  document.addEventListener('click', (ev) => {
    const target = ev.target;
    if (!target || typeof target.closest !== 'function') return;

    const modelOpt = target.closest('[data-select-model]');
    if (modelOpt) {
      const selected = modelOpt.getAttribute('data-select-model') || '';
      updateDefaultModel(selected || null);
      return;
    }

    const btn = target.closest('button');
    const id = btn ? btn.id : target.id;
    if (id === 'btn-model-picker') {
      state.modelMenuOpen = !state.modelMenuOpen;
      render({ focusSelector: '#btn-model-picker' });
      return;
    }

    if (state.modelMenuOpen && !target.closest('#model-picker')) {
      state.modelMenuOpen = false;
      render();
    }

    if (id === 'btn-retry') {
      fetchSnapshot({ forceRender: true });
      return;
    }
    if (id === 'btn-lang') {
      state.lang = state.lang === 'zh' ? 'en' : 'zh';
      render();
      return;
    }

    const rawErrToggle = target.closest('[data-toggle-raw-error]');
    if (rawErrToggle) {
      const workerId = rawErrToggle.getAttribute('data-toggle-raw-error');
      if (workerId) {
        if (state.expandedRawErrorIds.has(workerId)) state.expandedRawErrorIds.delete(workerId);
        else state.expandedRawErrorIds.add(workerId);
        const esc = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape : (s) => String(s);
        render({ focusSelector: `[data-toggle-raw-error="${esc(workerId)}"]` });
      }
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

    const stageBtn = target.closest('[data-stage-worker]');
    if (stageBtn) {
      const workerId = stageBtn.getAttribute('data-stage-worker');
      if (workerId) {
        state.selectedWorkerId = workerId;
        state.expandedIds.add(workerId);
        render();
        if (typeof document.querySelector === 'function' && typeof CSS !== 'undefined') {
          const card = document.querySelector(`[data-worker-id="${CSS.escape(workerId)}"]`);
          if (card && typeof card.scrollIntoView === 'function') {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }
      }
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
      const workerId = cardToggle.getAttribute('data-toggle-worker');
      if (workerId) {
        if (state.expandedIds.has(workerId)) state.expandedIds.delete(workerId);
        else state.expandedIds.add(workerId);
        state.selectedWorkerId = workerId;
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
    if (!document.hidden && !hasDragonGifs() && ts - lastAnimFrame >= 110) {
      lastAnimFrame = ts;
      state.spriteTick += 1;
      drawAllSprites();
    }
    if (typeof requestAnimationFrame === 'function' && !hasDragonGifs()) {
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
