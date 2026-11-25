/**
 * Antigravity Sidecar backend for Codex Monitor.
 * Serves the responsive Pixel-Art Codex Workshop UI and per-conversation JSON APIs.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Response, SidecarApp } from 'sidecar_sdk';
import { buildMonitorHtml, createMonitorStore, parseSettingsDefaultModel } from './monitor_store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const app = new SidecarApp();
const store = createMonitorStore(process.env);

const STATIC_ASSETS = {
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/sprites.js': ['sprites.js', 'application/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'application/javascript; charset=utf-8'],
};

const DRAGON_GIF_STATES = ['idle', 'thinking', 'coding', 'reviewing', 'completed', 'failed'];

function escapeHtmlFallback(msg) {
  return String(msg ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

app.page('/', () => {
  try {
    return new Response(buildMonitorHtml(HERE), {
      contentType: 'text/html; charset=utf-8',
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    console.error('[codex_monitor] failed to render /:', err);
    const msg = escapeHtmlFallback(err?.message || err);
    return new Response(
      `<!doctype html><html><body style="font-family:sans-serif;padding:16px"><h3>Codex Monitor Error</h3><pre>${msg}</pre></body></html>`,
      {
        status: 500,
        contentType: 'text/html; charset=utf-8',
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
});

for (const [route, [filename, contentType]] of Object.entries(STATIC_ASSETS)) {
  const filePath = join(HERE, filename);
  app.api(
    route,
    () => {
      try {
        return new Response(readFileSync(filePath, 'utf8'), {
          contentType,
          headers: { 'Cache-Control': 'no-store' },
        });
      } catch (err) {
        console.error(`[codex_monitor] failed to read ${filename}:`, err);
        return new Response('Not found', { status: 404, contentType: 'text/plain; charset=utf-8' });
      }
    },
    'GET'
  );
}

for (const state of DRAGON_GIF_STATES) {
  const filePath = join(HERE, 'assets', 'dragon', `${state}.gif`);
  app.api(
    `/assets/dragon/${state}.gif`,
    () => {
      try {
        return new Response(readFileSync(filePath), {
          contentType: 'image/gif',
          headers: { 'Cache-Control': 'public, max-age=3600' },
        });
      } catch (err) {
        console.error(`[codex_monitor] failed to read dragon/${state}.gif:`, err);
        return new Response('Not found', { status: 404, contentType: 'text/plain; charset=utf-8' });
      }
    },
    'GET'
  );
}

app.api(
  '/api/snapshot',
  async (data) => {
    try {
      const convId = String(data?.conversationId || app.config.conversationId || '').trim();
      const scope = data?.scope === 'all' ? 'all' : 'conversation';
      const limit = Number(data?.limit) || 50;
      return await store.getSnapshot({ conversationId: convId, scope, limit });
    } catch (err) {
      console.error('[codex_monitor] /api/snapshot failed:', err);
      throw err;
    }
  },
  'GET'
);

app.api(
  '/api/clear',
  async (data) => {
    try {
      const convId = String(data?.conversationId || app.config.conversationId || '').trim();
      const scope = data?.scope === 'all' ? 'all' : 'conversation';
      const limit = Number(data?.limit) || 50;
      const clearedCount = store.clearFinishedTasks({ conversationId: convId, scope });
      const snapshot = await store.getSnapshot({ conversationId: convId, scope, limit });
      return { cleared_count: clearedCount, ...snapshot };
    } catch (err) {
      console.error('[codex_monitor] /api/clear failed:', err);
      throw err;
    }
  },
  'POST'
);

app.api(
  '/api/settings',
  async (data) => {
    try {
      const convId = String(data?.conversationId || app.config.conversationId || '').trim();
      const scope = data?.scope === 'all' ? 'all' : 'conversation';
      const limit = Number(data?.limit) || 50;
      const defaultModel = parseSettingsDefaultModel(data?.default_model);
      store.updateSettings({ default_model: defaultModel });
      return await store.getSnapshot({ conversationId: convId, scope, limit });
    } catch (err) {
      console.error('[codex_monitor] /api/settings failed:', err);
      throw err;
    }
  },
  'POST'
);

app.run();
