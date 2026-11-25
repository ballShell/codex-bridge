import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  buildMonitorHtml,
  createMonitorStore,
  parseSettingsDefaultModel,
  resolvePaths,
} from '../sidecars/codex_monitor/monitor_store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIDECAR_DIR = resolve(HERE, '..', 'sidecars', 'codex_monitor');

function makeMockCanvas(w, h) {
  let fillOps = 0;
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    imageSmoothingEnabled: true,
    save() {},
    restore() {},
    scale() {},
    translate() {},
    clearRect() {},
    fillRect() {
      fillOps += 1;
    },
    strokeRect() {},
    fillText() {},
    measureText(s) {
      return { width: String(s).length * 6 };
    },
  };
  return {
    width: w,
    height: h,
    clientWidth: w,
    style: {},
    getContext() {
      return ctx;
    },
    getFillOps() {
      return fillOps;
    },
  };
}

function loadClassicSprites(sandboxOverrides = {}) {
  const spritesCode = readFileSync(join(SIDECAR_DIR, 'sprites.js'), 'utf8');
  const ctx = {
    window: { devicePixelRatio: 1 },
    Math,
    ...sandboxOverrides,
  };
  ctx.globalThis = ctx;
  vm.runInNewContext(spritesCode, ctx, { filename: 'sprites.js' });
  return { CodexSprites: ctx.CodexSprites, context: ctx };
}

function makeFakeCodexEnv(rootDir) {
  const codexHome = join(rootDir, 'codex_home');
  mkdirSync(join(codexHome, 'sessions'), { recursive: true });
  const catalogPath = join(codexHome, 'custom-catalog.json');
  writeFileSync(
    catalogPath,
    JSON.stringify({
      models: [
        { slug: 'gpt-6-astra', display_name: 'gpt-6-astra', visibility: 'list' },
        { slug: 'gpt-6.2-sol', display_name: 'gpt-6.2-sol', visibility: 'list' },
        { slug: 'hidden-internal', display_name: 'hidden', visibility: 'hide' },
      ],
    }),
    'utf8'
  );
  writeFileSync(
    join(codexHome, 'config.toml'),
    `model = "gpt-6-astra"\nmodel_reasoning_effort = "high"\nmodel_provider = "custom"\nmodel_catalog_json = "${catalogPath}"\n`,
    'utf8'
  );
  return { codexHome, catalogPath };
}

test('resolvePaths derives brainDir and pluginDataDir from ANTIGRAVITY_EXECUTABLE_DATA_DIR', () => {
  const paths = resolvePaths({
    ANTIGRAVITY_EXECUTABLE_DATA_DIR: '/tmp/appData/sidecar_data/codex-bridge/codex_monitor/data',
  });
  assert.equal(paths.appDataDir, '/tmp/appData');
  assert.equal(paths.brainDir, '/tmp/appData/brain');
  assert.equal(paths.pluginDataDir, '/tmp/appData/plugin_data/codex-bridge');
  assert.equal(paths.tasksDir, '/tmp/appData/plugin_data/codex-bridge/tasks');
});

test('per-conversation isolation, subagent tree inheritance, historical backfill, and scoped clear', async () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-monitor-test-'));
  try {
    const appData = join(root, 'app_data');
    const brainDir = join(appData, 'brain');
    const dataDir = join(appData, 'plugin_data', 'codex-bridge');
    const tasksDir = join(dataDir, 'tasks');
    mkdirSync(tasksDir, { recursive: true });
    const { codexHome } = makeFakeCodexEnv(root);

    const convA = '11111111-1111-1111-1111-111111111111';
    const convSub = '33333333-3333-3333-3333-333333333333';
    const convB = '22222222-2222-2222-2222-222222222222';

    // Conv A transcript spawns subagent convSub and references legacy task_deadbeef1234
    const logsA = join(brainDir, convA, '.system_generated', 'logs');
    mkdirSync(logsA, { recursive: true });
    writeFileSync(
      join(logsA, 'transcript.jsonl'),
      [
        JSON.stringify({
          type: 'GENERIC',
          content: `{"spec":{"typeName":"codex-worker"},"result":{"conversationId":"${convSub}"}}`,
        }),
        JSON.stringify({
          type: 'GENERIC',
          content: '{"task_id":"task_deadbeef1234","status":"completed"}',
        }),
      ].join('\n') + '\n',
      'utf8'
    );

    const logsB = join(brainDir, convB, '.system_generated', 'logs');
    mkdirSync(logsB, { recursive: true });
    writeFileSync(join(logsB, 'transcript.jsonl'), JSON.stringify({ type: 'USER_INPUT', content: 'hi' }) + '\n', 'utf8');

    // Task 1: belongs directly to convA (completed)
    writeFileSync(
      join(tasksDir, 'task_aaaa11112222.json'),
      JSON.stringify({
        task_id: 'task_aaaa11112222',
        status: 'completed',
        activity: 'completed',
        mode: 'exec',
        conversation_id: convA,
        model: 'gpt-6.2-sol',
        reasoning_effort: 'high',
        elapsed_ms: 4000,
        started_at: 1000,
        finished_at: 1004,
        usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, total_tokens: 120 },
      }),
      'utf8'
    );

    // Task 2: spawned by subagent convSub (running under current process PID so dead-PID check keeps it running!)
    writeFileSync(
      join(tasksDir, 'task_bbbb11112222.json'),
      JSON.stringify({
        task_id: 'task_bbbb11112222',
        status: 'running',
        activity: 'coding',
        mode: 'exec',
        conversation_id: convSub,
        model: 'gpt-6.1-sol',
        reasoning_effort: 'xhigh',
        pid: process.pid,
        owner_pid: process.pid,
        elapsed_ms: 1500,
        started_at: Date.now() / 1000 - 1.5,
      }),
      'utf8'
    );

    // Task 3: legacy historical task without conversation_id, referenced in convA's transcript
    writeFileSync(
      join(tasksDir, 'task_deadbeef1234.json'),
      JSON.stringify({
        task_id: 'task_deadbeef1234',
        status: 'completed',
        activity: 'completed',
        mode: 'plan',
        model: 'gpt-6-astra',
        reasoning_effort: 'medium',
        elapsed_ms: 2000,
        started_at: 900,
        finished_at: 902,
        usage: { input_tokens: 200, output_tokens: 50, total_tokens: 250 },
      }),
      'utf8'
    );

    // Task 4: belongs exclusively to convB
    writeFileSync(
      join(tasksDir, 'task_cccc11112222.json'),
      JSON.stringify({
        task_id: 'task_cccc11112222',
        status: 'completed',
        activity: 'completed',
        mode: 'review',
        conversation_id: convB,
        model: 'gpt-6.2-sol',
        reasoning_effort: 'low',
        elapsed_ms: 3000,
        started_at: 1010,
        finished_at: 1013,
        usage: { input_tokens: 500, output_tokens: 100, total_tokens: 600 },
      }),
      'utf8'
    );

    const store = createMonitorStore({
      ANTIGRAVITY_EXECUTABLE_DATA_DIR: join(appData, 'sidecar_data', 'codex-bridge', 'codex_monitor', 'data'),
      CODEX_HOME: codexHome,
      CODEX_BIN: '/nonexistent/codex-bin',
    });

    // No conversationId -> empty safe state
    const emptySnap = await store.getSnapshot({ conversationId: '', scope: 'conversation' });
    assert.equal(emptySnap.has_conversation, false);
    assert.equal(emptySnap.workers.length, 0);
    assert.equal(emptySnap.stats.total_workers, 0);

    // Conv A sees direct task + subagent running task + historical transcript task, NEVER convB
    const snapA = await store.getSnapshot({ conversationId: convA, scope: 'conversation' });
    assert.equal(snapA.has_conversation, true);
    assert.equal(snapA.subagent_count, 1);
    assert.equal(snapA.stats.total_workers, 3);
    assert.equal(snapA.stats.running_count, 1);
    assert.equal(snapA.stats.completed_count, 2);
    assert.equal(snapA.stats.tokens.total_tokens, 370);
    assert.deepEqual(
      snapA.workers.map((w) => w.task_id),
      ['task_bbbb11112222', 'task_aaaa11112222', 'task_deadbeef1234']
    );

    // Conv B sees ONLY task 4
    const snapB = await store.getSnapshot({ conversationId: convB, scope: 'conversation' });
    assert.equal(snapB.stats.total_workers, 1);
    assert.equal(snapB.stats.running_count, 0);
    assert.equal(snapB.stats.tokens.total_tokens, 600);
    assert.deepEqual(
      snapB.workers.map((w) => w.task_id),
      ['task_cccc11112222']
    );

    // Scope 'all' sees all 4 bridge tasks and 0 CLI sessions
    const snapAll = await store.getSnapshot({ conversationId: convA, scope: 'all' });
    assert.equal(snapAll.stats.total_workers, 4);
    assert.equal(snapAll.stats.cli_count, 0);

    // Clearing convA removes ONLY convA's 2 finished tasks, keeping running task_bbbb11112222 & convB's task
    const removed = store.clearFinishedTasks({ conversationId: convA, scope: 'conversation' });
    assert.equal(removed, 2);

    const afterA = await store.getSnapshot({ conversationId: convA, scope: 'conversation' });
    assert.deepEqual(
      afterA.workers.map((w) => w.task_id),
      ['task_bbbb11112222']
    );
    const afterB = await store.getSnapshot({ conversationId: convB, scope: 'conversation' });
    assert.deepEqual(
      afterB.workers.map((w) => w.task_id),
      ['task_cccc11112222']
    );

    // Model catalog discovery & lightweight plugin-isolated default model settings
    assert.deepEqual(
      afterB.settings.available_models.map((m) => m.id),
      ['gpt-6-astra', 'gpt-6.2-sol']
    );
    assert.equal(afterB.settings.default_model, null);
    assert.equal(afterB.settings.codex_default_model, 'gpt-6-astra');
    assert.equal(afterB.settings.effective_model, 'gpt-6-astra');

    store.updateSettings({ default_model: 'gpt-6.2-sol' });
    const isolatedSnap = await store.getSnapshot({ conversationId: convB, scope: 'conversation' });
    assert.equal(isolatedSnap.settings.default_model, 'gpt-6.2-sol');
    assert.equal(isolatedSnap.settings.codex_default_model, 'gpt-6-astra');
    assert.equal(isolatedSnap.settings.effective_model, 'gpt-6.2-sol');
    assert.equal(isolatedSnap.settings.source, 'plugin');

    store.updateSettings({ default_model: null });
    const resetSnap = await store.getSnapshot({ conversationId: convB, scope: 'conversation' });
    assert.equal(resetSnap.settings.default_model, null);
    assert.equal(resetSnap.settings.effective_model, 'gpt-6-astra');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('classic sprites.js renders all 6 pixel states, standby stage, and multi-worker workshop stage cleanly', () => {
  const { CodexSprites } = loadClassicSprites();
  const { ANIMATION_STATES, drawWorkerSprite, drawWorkshopStage, getPaletteForWorker } = CodexSprites;

  assert.equal(ANIMATION_STATES.length, 6);
  for (const pose of ANIMATION_STATES) {
    const c = makeMockCanvas(48, 48);
    const p = getPaletteForWorker({ model: 'gpt-6.2-sol', worker_id: 'w1' }, 0);
    drawWorkerSprite(c, pose, p, 4, 'xhigh', 'dark');
    assert.ok(c.getFillOps() > 0, `Expected fillOps > 0 for state ${pose}`);
  }

  // Standby stage with 0 workers still draws background + standby pixel bot
  const standbyStage = makeMockCanvas(360, 128);
  const standbyHits = drawWorkshopStage(standbyStage, [], { theme: 'light' }, 0);
  assert.equal(standbyHits.length, 0);
  assert.ok(standbyStage.getFillOps() > 0, 'Expected standby stage to draw pixels');

  const stage = makeMockCanvas(360, 128);
  const workers = [
    { worker_id: 'w1', model: 'gpt-6.2-sol', reasoning_effort: 'xhigh', status: 'running', activity: 'coding' },
    { worker_id: 'w2', model: 'gpt-6.1-sol', reasoning_effort: 'medium', status: 'running', activity: 'thinking' },
    { worker_id: 'w3', model: 'gpt-6-astra', reasoning_effort: 'low', status: 'completed', activity: 'completed' },
  ];
  const hitboxes = drawWorkshopStage(stage, workers, { theme: 'dark', selectedWorkerId: 'w1' }, 3);
  assert.equal(hitboxes.length, 2);
});

test('buildMonitorHtml inlines classic CSS/JS, dragon GIF data URIs, and preserves fallback shell', () => {
  const html = buildMonitorHtml(SIDECAR_DIR);
  assert.match(html, /src="\/preload\.js"/);
  assert.match(html, /<style>[\s\S]*\.app-shell[\s\S]*<\/style>/);
  assert.match(html, /globalThis\.__CODEX_DRAGON_GIFS__\s*=/);
  assert.match(html, /"idle":"data:image\/gif;base64,/);
  assert.match(html, /"reviewing":"data:image\/gif;base64,/);
  assert.match(html, /"failed":"data:image\/gif;base64,/);
  assert.match(html, /<script>[\s\S]*globalThis\.CodexSprites[\s\S]*<\/script>/);
  assert.doesNotMatch(html, /type\s*=\s*["']module["']/i);
  assert.doesNotMatch(html, /<!--INLINE_STYLES_START-->/);
  assert.doesNotMatch(html, /<!--INLINE_SCRIPTS_START-->/);
  assert.match(html, /<div id="app">[\s\S]*Codex Monitor[\s\S]*<\/div>/);
});

async function runAppInMockVm({ fetchImpl, dragonGifs = null }) {
  const appCode = readFileSync(join(SIDECAR_DIR, 'app.js'), 'utf8');
  const spritesCode = readFileSync(join(SIDECAR_DIR, 'sprites.js'), 'utf8');
  const appRoot = { innerHTML: '' };
  const workshopCanvas = makeMockCanvas(360, 128);
  const rootEl = {
    attrs: {},
    style: {},
    setAttribute(k, v) {
      this.attrs[k] = v;
    },
    appendChild() {},
  };
  const docListeners = {};
  const winListeners = {};
  const focusCalls = [];
  let nextPollCallback = null;
  let lastOptionNodes = [];

  function parseModelOptionNodes() {
    const nodes = [];
    const re = /data-select-model="([^"]*)"/g;
    let m;
    while ((m = re.exec(appRoot.innerHTML)) !== null) {
      const val = m[1];
      const node = {
        id: '',
        selector: `[data-select-model="${val}"]`,
        hasAttribute: (attr) => attr === 'data-select-model',
        getAttribute: (attr) => (attr === 'data-select-model' ? val : null),
        focus(opts) {
          ctx.document.activeElement = node;
          focusCalls.push({ selector: node.selector, opts });
        },
      };
      nodes.push(node);
    }
    lastOptionNodes = nodes;
    return nodes;
  }

  const ctx = {
    console,
    Math,
    Date,
    Set,
    Map,
    JSON,
    URLSearchParams,
    Error,
    navigator: { language: 'zh-CN' },
    location: { search: '?conversationId=11111111-1111-1111-1111-111111111111' },
    CSS: { escape: (s) => String(s) },
    getComputedStyle: () => ({ color: 'rgb(255, 255, 255)' }),
    setTimeout: (fn) => {
      nextPollCallback = fn;
      return 1;
    },
    clearTimeout: () => {
      nextPollCallback = null;
    },
    setInterval: () => 0,
    clearInterval: () => {},
    document: {
      hidden: false,
      activeElement: null,
      documentElement: rootEl,
      body: rootEl,
      createElement: () => ({ style: {}, remove() {} }),
      getElementById: (id) => (id === 'app' ? appRoot : id === 'workshop-canvas' ? workshopCanvas : null),
      querySelector: (selector) => {
        const opt = lastOptionNodes.find((n) => n.selector === selector);
        if (opt) return opt;
        return {
          selector,
          focus(opts) {
            focusCalls.push({ selector, opts });
          },
        };
      },
      querySelectorAll: (selector) => (selector === '[data-select-model]' ? parseModelOptionNodes() : []),
      addEventListener(name, fn) {
        docListeners[name] = fn;
      },
    },
    window: {
      devicePixelRatio: 1,
      sidecar: {
        conversationId: '11111111-1111-1111-1111-111111111111',
        fetch: fetchImpl,
      },
      addEventListener(name, fn) {
        winListeners[name] = fn;
      },
    },
  };
  ctx.globalThis = ctx;
  ctx.self = ctx;
  if (dragonGifs) {
    ctx.__CODEX_DRAGON_GIFS__ = dragonGifs;
  }

  vm.runInNewContext(spritesCode, ctx, { filename: 'sprites.js' });
  vm.runInNewContext(appCode, ctx, { filename: 'app.js' });
  const initialHtml = appRoot.innerHTML;
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  return {
    initialHtml,
    get finalHtml() {
      return appRoot.innerHTML;
    },
    mounted: Boolean(ctx.window.__codexMonitorMounted),
    workshopFillOps: workshopCanvas.getFillOps(),
    focusCalls,
    dispatchClick(target) {
      if (typeof docListeners.click === 'function') {
        docListeners.click({ target });
      }
    },
    dispatchChange(target) {
      if (typeof docListeners.change === 'function') {
        docListeners.change({ target });
      }
    },
    dispatchKeydown(key) {
      let prevented = false;
      if (typeof docListeners.keydown === 'function') {
        docListeners.keydown({
          key,
          preventDefault() {
            prevented = true;
          },
        });
      }
      return prevented;
    },
    setActiveElement(el) {
      ctx.document.activeElement = el;
    },
    get activeElement() {
      return ctx.document.activeElement;
    },
    async triggerNextPoll() {
      if (typeof nextPollCallback === 'function') {
        const fn = nextPollCallback;
        nextPollCallback = null;
        fn();
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
      }
    },
  };
}

test('app.js renders default dashboard for zero-task conversations and degrades gracefully on fetch error', async () => {
  const zeroTaskRun = await runAppInMockVm({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return {
          generated_at: Date.now() / 1000,
          scope: 'conversation',
          conversation_id: '11111111-1111-1111-1111-111111111111',
          has_conversation: true,
          subagent_count: 0,
          cli_status: { binary_found: true, auth_ready: true, default_model: 'gpt-6.2-sol' },
          settings: {
            default_model: null,
            effective_model: 'gpt-6.2-sol',
            codex_default_model: 'gpt-6.2-sol',
            source: 'codex',
            available_models: [
              { id: 'gpt-6-astra', label: 'gpt-6-astra' },
              { id: 'gpt-6.2-sol', label: 'gpt-6.2-sol' },
            ],
          },
          stats: {
            total_workers: 0,
            running_count: 0,
            completed_count: 0,
            failed_count: 0,
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
      },
    }),
  });

  assert.equal(zeroTaskRun.mounted, true);
  assert.ok(zeroTaskRun.workshopFillOps > 0);
  assert.match(zeroTaskRun.initialHtml, /id="workshop-canvas"/);
  assert.match(zeroTaskRun.initialHtml, /0 \/ 0/);
  assert.match(zeroTaskRun.finalHtml, /CLI 就绪/);
  assert.match(zeroTaskRun.finalHtml, /id="btn-model-picker"/);
  assert.match(zeroTaskRun.finalHtml, /跟随 · gpt-6\.2-sol/);
  assert.match(zeroTaskRun.finalHtml, /class="empty-title"/);
  assert.match(zeroTaskRun.finalHtml, /class="empty-card"/);
  assert.doesNotMatch(zeroTaskRun.finalHtml, /class="empty-desc"/);
  assert.doesNotMatch(zeroTaskRun.finalHtml, /data-action="switch-all"/);
  assert.doesNotMatch(zeroTaskRun.finalHtml, /<button class="btn" id="btn-refresh" disabled/);

  const errorRun = await runAppInMockVm({
    fetchImpl: async () => {
      throw new Error('backend unreachable');
    },
  });
  assert.equal(errorRun.mounted, true);
  assert.match(errorRun.finalHtml, /class="error-banner"/);
  assert.match(errorRun.finalHtml, /backend unreachable/);
  assert.match(errorRun.finalHtml, /id="workshop-canvas"/);
  assert.match(errorRun.finalHtml, /0 \/ 0/);
});

test('app.js omits pose preview strip, renders unified KPI chips, model picker, and error callout cleanly', async () => {
  const settingsPosts = [];
  const basePayload = {
    generated_at: Date.now() / 1000,
    scope: 'conversation',
    conversation_id: '11111111-1111-1111-1111-111111111111',
    has_conversation: true,
    subagent_count: 2,
    cli_status: { binary_found: true, auth_ready: true, default_model: 'gpt-6.2-sol', codex_default_model: 'gpt-6-astra' },
    settings: {
      default_model: 'gpt-6.2-sol',
      effective_model: 'gpt-6.2-sol',
      codex_default_model: 'gpt-6-astra',
      source: 'plugin',
      available_models: [
        { id: 'gpt-6-astra', label: 'gpt-6-astra' },
        { id: 'gpt-6.2-sol', label: 'gpt-6.2-sol' },
      ],
    },
    stats: {
      total_workers: 2,
      running_count: 1,
      completed_count: 0,
      failed_count: 1,
      tokens: {
        input_tokens: 120000,
        cached_input_tokens: 30000,
        output_tokens: 4000,
        reasoning_output_tokens: 99,
        total_tokens: 124000,
        cache_hit_rate: 0.25,
      },
      total_elapsed_ms: 185000,
      avg_elapsed_ms: 92500,
      total_changed_files: 3,
      success_rate: 0,
      by_model: [{ model: 'gpt-6.2-sol', count: 2, running: 1, total_tokens: 124000 }],
      by_effort: [{ effort: 'high', count: 2 }],
      by_mode: [{ mode: 'review', count: 2 }],
    },
    workers: [
      {
        worker_id: 'task_run_1',
        model: 'gpt-6.2-sol',
        reasoning_effort: 'high',
        mode: 'review',
        status: 'running',
        activity: 'reviewing',
        elapsed_ms: 45000,
        max_duration_seconds: 180,
        idle_ms: 35000,
        prompt_preview: 'Review auth middleware changes',
        usage: { input_tokens: 60000, cached_input_tokens: 10000, output_tokens: 1000, total_tokens: 61000 },
      },
      {
        worker_id: 'task_to_2',
        model: 'gpt-6.2-sol',
        reasoning_effort: 'high',
        mode: 'review',
        status: 'failed',
        activity: 'timed_out',
        timed_out: true,
        timeout_reason: 'max_duration',
        max_duration_seconds: 140,
        elapsed_ms: 140000,
        prompt_preview: 'Review full repo diff',
        error: 'Codex task exceeded hard duration limit (140s).',
        usage: { input_tokens: 60000, cached_input_tokens: 20000, output_tokens: 3000, total_tokens: 63000 },
      },
      {
        worker_id: 'task_http404_3',
        model: 'gpt-6.2-sol',
        reasoning_effort: 'medium',
        mode: 'review',
        status: 'failed',
        activity: 'failed',
        max_duration_seconds: 300,
        soft_budget_seconds: 240,
        max_idle_seconds: 150,
        elapsed_ms: 56000,
        session_id: '01a2114a-2ef7-7610-b0fd-ea23345f47b8',
        conversation_id: '6d1eed8d-5c50-4530-9048-cb2ced0b3898',
        cwd: '/Users/ballshell/Documents/Codex/AgentsWorkSpace/Antigravity-codex-bridge',
        prompt_preview: 'Review monitor refactor',
        error:
          'Reconnecting... 1/5 (unexpected status 404 Not Found: <html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>, url: https://ai.mindflow.com.cn/v1/responses)\n' +
          'Reconnecting... 5/5 (unexpected status 404 Not Found: <html><head><title>404 Not Found</title></head><body><h1>404 Not Found</h1></body></html>, url: https://ai.mindflow.com.cn/v1/responses)',
        usage: { input_tokens: 236000, cached_input_tokens: 165900, output_tokens: 506, reasoning_output_tokens: 29, total_tokens: 236506 },
      },
    ],
  };

  const populatedRun = await runAppInMockVm({
    fetchImpl: async (url, options) => {
      if (url === '/api/settings') {
        const body = JSON.parse(options.body);
        settingsPosts.push(body);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              ...basePayload,
              settings: {
                ...basePayload.settings,
                default_model: body.default_model,
                effective_model: body.default_model || 'gpt-6-astra',
                source: body.default_model ? 'plugin' : 'codex',
              },
            };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return basePayload;
        },
      };
    },
  });

  assert.equal(populatedRun.mounted, true);
  assert.doesNotMatch(populatedRun.finalHtml, /class="pose-strip"|data-pose=/);
  assert.doesNotMatch(populatedRun.finalHtml, /id="btn-refresh"/);
  assert.doesNotMatch(populatedRun.finalHtml, /id="btn-clear"/);
  assert.doesNotMatch(populatedRun.finalHtml, /class="breakdown-block"/);
  assert.doesNotMatch(populatedRun.finalHtml, /当前会话 \+2 子代理/);
  assert.match(populatedRun.finalHtml, /class="worker-sprite" width="40" height="40" data-sprite-worker="task_run_1"/);
  assert.doesNotMatch(populatedRun.finalHtml, /class="stack-bar"/);
  assert.match(populatedRun.finalHtml, /<button type="button" class="worker-toggle" data-toggle-worker="task_run_1" aria-expanded="false">/);
  // Work statistics uses unified kpi-pill chips with only Cache under Total tokens (no progress bar / output / reasoning)
  assert.doesNotMatch(populatedRun.finalHtml, /class="kpi-token-bar"/);
  assert.match(populatedRun.finalHtml, /class="kpi-pill"[^>]*><span class="kpi-dot is-ok"[^>]*><\/span><span>缓存 25%<\/span><\/span>/);
  assert.match(populatedRun.finalHtml, /<span>0 完成<\/span>/);
  assert.match(populatedRun.finalHtml, /<span>1 失败<\/span>/);
  assert.match(populatedRun.finalHtml, /<span>平均 1m 32s<\/span>/);
  assert.match(populatedRun.finalHtml, /<span>0\/1 通过<\/span>/);
  assert.doesNotMatch(populatedRun.finalHtml, /<span>输出 4\.00K<\/span>/);
  assert.doesNotMatch(populatedRun.finalHtml, /<span>推理 99<\/span>/);
  // Custom theme-native model picker opens listbox and posts /api/settings on option click
  assert.match(populatedRun.finalHtml, /id="btn-model-picker"[\s\S]*class="model-trigger is-isolated"/);
  assert.doesNotMatch(populatedRun.finalHtml, /class="model-menu"/);
  populatedRun.dispatchClick({
    id: 'btn-model-picker',
    closest(sel) {
      if (sel === 'button') return { id: 'btn-model-picker' };
      if (sel === '#model-picker') return {};
      return null;
    },
  });
  assert.match(populatedRun.finalHtml, /class="model-menu" role="listbox"/);
  assert.match(populatedRun.finalHtml, /data-select-model="gpt-6-astra"/);
  populatedRun.dispatchClick({
    id: '',
    closest(sel) {
      if (sel === '[data-select-model]') return { getAttribute: () => 'gpt-6-astra' };
      return null;
    },
  });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(settingsPosts.length, 1);
  assert.equal(settingsPosts[0].default_model, 'gpt-6-astra');
  assert.doesNotMatch(populatedRun.finalHtml, /class="model-menu"/);
  assert.match(populatedRun.finalHtml, /class="meta-tag" title="gpt-6\.2-sol">gpt-6\.2-sol</);
  assert.match(populatedRun.finalHtml, /data-budget-worker="task_run_1">预设 3m</);
  assert.match(populatedRun.finalHtml, /data-remaining-worker="task_run_1"/);
  assert.match(populatedRun.finalHtml, /status-text timed_out">已超时</);
  // Collapsed HTTP 404 error shows concise summary without leaking raw HTML tags
  assert.match(populatedRun.finalHtml, /worker-err-badge">HTTP 404</);
  assert.match(populatedRun.finalHtml, /ai\.mindflow\.com\.cn · 重试 5 次/);
  assert.doesNotMatch(populatedRun.finalHtml, /&lt;html&gt;/);

  // Expanding the HTTP 404 worker renders structured metrics, KV metadata, error callout (without assertive alert), and collapsed raw log toggle
  populatedRun.dispatchClick({
    id: '',
    closest(sel) {
      if (sel === '[data-toggle-worker]') return { getAttribute: () => 'task_http404_3' };
      return null;
    },
  });
  assert.match(populatedRun.finalHtml, /class="error-callout "/);
  assert.doesNotMatch(populatedRun.finalHtml, /class="error-callout[^"]*" role="alert"/);
  assert.match(populatedRun.finalHtml, /上游接口返回 404 Not Found/);
  assert.match(populatedRun.finalHtml, /class="detail-metrics detail-metrics-4"/);
  assert.match(populatedRun.finalHtml, /class="detail-metrics detail-metrics-3"/);
  assert.match(populatedRun.finalHtml, /class="detail-kv"/);
  assert.match(populatedRun.finalHtml, /data-toggle-raw-error="task_http404_3" aria-expanded="false"/);
  assert.doesNotMatch(populatedRun.finalHtml, /class="error-raw-pre"/);

  // Expanding raw error log reveals full escaped raw output inside bounded pre and restores focus
  populatedRun.dispatchClick({
    id: '',
    closest(sel) {
      if (sel === '[data-toggle-raw-error]') return { getAttribute: () => 'task_http404_3' };
      return null;
    },
  });
  assert.match(populatedRun.finalHtml, /data-toggle-raw-error="task_http404_3" aria-expanded="true"/);
  assert.match(populatedRun.finalHtml, /class="error-raw-pre" data-raw-error-worker="task_http404_3"/);
  assert.equal(
    populatedRun.focusCalls.some((c) => c.selector === '[data-toggle-raw-error="task_http404_3"]'),
    true
  );

  // When dragon GIFs are injected, both workshop stage and worker rows render animated dragon images
  const dragonRun = await runAppInMockVm({
    dragonGifs: {
      idle: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      thinking: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      coding: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      reviewing: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      completed: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
      failed: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
    },
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async json() {
        return basePayload;
      },
    }),
  });
  assert.match(dragonRun.finalHtml, /id="workshop-stage"/);
  assert.match(dragonRun.finalHtml, /class="stage-dragon"[^>]*data-dragon-state="reviewing"/);
  assert.match(dragonRun.finalHtml, /data-stage-worker="task_run_1"/);
  assert.match(dragonRun.finalHtml, /class="worker-dragon"[^>]*data-dragon-worker="task_run_1" data-dragon-state="reviewing"/);
  assert.match(dragonRun.finalHtml, /class="worker-dragon"[^>]*data-dragon-worker="task_http404_3" data-dragon-state="failed"/);
});

test('model picker supports ArrowUp/ArrowDown/Escape, outside click, poll focus preservation, and strict settings validation', async () => {
  // Strict /api/settings default_model validation rejects non-strings instead of coercing
  assert.equal(parseSettingsDefaultModel(undefined), null);
  assert.equal(parseSettingsDefaultModel(null), null);
  assert.equal(parseSettingsDefaultModel('   '), null);
  assert.equal(parseSettingsDefaultModel(' gpt-6.2-sol '), 'gpt-6.2-sol');
  for (const bad of [123, true, false, {}, ['gpt-6.2-sol'], 'bad model name']) {
    assert.throws(() => parseSettingsDefaultModel(bad), (err) => err?.statusCode === 400);
  }

  let pollTick = 0;
  const run = await runAppInMockVm({
    fetchImpl: async () => {
      pollTick += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            generated_at: Date.now() / 1000,
            scope: 'conversation',
            conversation_id: '11111111-1111-1111-1111-111111111111',
            has_conversation: true,
            subagent_count: 0,
            cli_status: { binary_found: true, auth_ready: true, default_model: 'gpt-6.2-sol' },
            settings: {
              default_model: null,
              effective_model: 'gpt-6.2-sol',
              codex_default_model: 'gpt-6.2-sol',
              source: 'codex',
              available_models: [
                { id: 'gpt-6-astra', label: 'gpt-6-astra' },
                { id: 'gpt-6.2-sol', label: 'gpt-6.2-sol' },
              ],
            },
            stats: {
              total_workers: 1,
              running_count: 1,
              completed_count: 0,
              failed_count: 0,
              tokens: {
                input_tokens: 1000 * pollTick,
                cached_input_tokens: 0,
                output_tokens: 0,
                reasoning_output_tokens: 0,
                total_tokens: 1000 * pollTick,
                cache_hit_rate: 0,
              },
              total_elapsed_ms: 5000 * pollTick,
              avg_elapsed_ms: 5000 * pollTick,
              total_changed_files: 0,
              success_rate: 0,
              by_model: [],
              by_effort: [],
              by_mode: [],
            },
            workers: [
              {
                task_id: 'task_live_1',
                mode: 'review',
                status: 'running',
                model: 'gpt-6.2-sol',
                reasoning_effort: 'medium',
                elapsed_ms: 5000 * pollTick,
                max_duration_seconds: 180,
                remaining_ms: 175000,
                tokens: { total_tokens: 1000 * pollTick },
              },
            ],
          };
        },
      };
    },
  });

  // Open picker; activeElement is still the trigger button (not an option)
  run.dispatchClick({
    id: 'btn-model-picker',
    closest(sel) {
      if (sel === 'button') return { id: 'btn-model-picker' };
      if (sel === '#model-picker') return {};
      return null;
    },
  });
  run.setActiveElement({
    id: 'btn-model-picker',
    hasAttribute: () => false,
    getAttribute: () => null,
  });

  // ArrowUp from trigger focuses the LAST option (gpt-6.2-sol), not second-to-last
  assert.equal(run.dispatchKeydown('ArrowUp'), true);
  assert.equal(run.activeElement?.getAttribute('data-select-model'), 'gpt-6.2-sol');

  // ArrowDown wraps to the FIRST option ("" = Follow Codex)
  assert.equal(run.dispatchKeydown('ArrowDown'), true);
  assert.equal(run.activeElement?.getAttribute('data-select-model'), '');

  // Poll re-render while open preserves focus on the empty-string Follow Codex option
  const prevFocusLen = run.focusCalls.length;
  await run.triggerNextPoll();
  assert.equal(
    run.focusCalls.slice(prevFocusLen).some((c) => c.selector === '[data-select-model=""]'),
    true
  );

  // Escape closes picker and restores focus to #btn-model-picker
  const preEscLen = run.focusCalls.length;
  run.dispatchKeydown('Escape');
  assert.doesNotMatch(run.finalHtml, /class="model-menu"/);
  assert.equal(
    run.focusCalls.slice(preEscLen).some((c) => c.selector === '#btn-model-picker'),
    true
  );

  // Re-open and verify outside click dismisses menu
  run.dispatchClick({
    id: 'btn-model-picker',
    closest(sel) {
      if (sel === 'button') return { id: 'btn-model-picker' };
      if (sel === '#model-picker') return {};
      return null;
    },
  });
  assert.match(run.finalHtml, /class="model-menu"/);
  run.dispatchClick({
    id: '',
    closest: () => null,
  });
  assert.doesNotMatch(run.finalHtml, /class="model-menu"/);
});

test('Codex discovery finds macOS GUI user-space bins with a minimal PATH', async () => {
  const { resolveCodexBin, resolveCodexCommand } = await import('../sidecars/codex_monitor/monitor_store.mjs');
  const root = mkdtempSync(join(tmpdir(), 'codex gui path-'));
  try {
    const candidate = join(root, '.volta', 'bin', 'codex');
    mkdirSync(dirname(candidate), { recursive: true });
    writeFileSync(candidate, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.equal(resolveCodexBin({ PATH: '/usr/bin', HOME: root }, 'darwin'), candidate);

    // Windows npm shim (%dp0% and %~dp0) resolves to [node, jsEntry] while unknown .cmd is rejected
    const npmDir = join(root, 'npm-win');
    const jsEntry = join(npmDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    mkdirSync(dirname(jsEntry), { recursive: true });
    writeFileSync(jsEntry, 'console.log("ok");\n', 'utf8');
    const shim = join(npmDir, 'codex.cmd');
    writeFileSync(shim, '@ECHO off\r\n"%_prog%" "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n', 'utf8');
    const cmd = resolveCodexCommand({ CODEX_BIN: shim, PATH: npmDir }, 'win32');
    assert.ok(cmd);
    assert.equal(cmd[1], jsEntry);

    const badShim = join(npmDir, 'unknown.cmd');
    writeFileSync(badShim, '@echo off\r\necho arbitrary\r\n', 'utf8');
    assert.equal(resolveCodexCommand({ CODEX_BIN: badShim, PATH: npmDir }, 'win32'), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
