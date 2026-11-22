/**
 * Procedural 24x24 pixel-art Codex mascot & workshop animation engine.
 * Crisp integer-scaled Canvas 2D rendering with zero external assets.
 */

(() => {
  'use strict';

const ANIMATION_STATES = [
  'idle',
  'thinking',
  'coding',
  'reviewing',
  'completed',
  'failed',
];

const MODEL_PALETTES = [
  {
    match: /gpt-6\.2/i,
    accent: '#22d3ee',
    glow: '#a5f3fc',
    trim: '#0891b2',
    badge: '6.2',
  },
  {
    match: /gpt-6\.1/i,
    accent: '#fbbf24',
    glow: '#fde68a',
    trim: '#d97706',
    badge: '6.1',
  },
  {
    match: /gpt-6/i,
    accent: '#34d399',
    glow: '#a7f3d0',
    trim: '#059669',
    badge: '6',
  },
  {
    match: /gpt-5|o3|o4/i,
    accent: '#c084fc',
    glow: '#e9d5ff',
    trim: '#9333ea',
    badge: '5',
  },
];

const EXTRA_TRIMS = ['#0ea5e9', '#10b981', '#f59e0b', '#ec4899', '#8b5cf6', '#14b8a6'];

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function getPaletteForWorker(worker, index = 0) {
  const modelName = String(worker?.model || '');
  const matched = MODEL_PALETTES.find((p) => p.match.test(modelName));
  if (matched) {
    const trim =
      index === 0 ? matched.trim : EXTRA_TRIMS[(index + hashString(worker?.worker_id || '')) % EXTRA_TRIMS.length];
    return {
      accent: matched.accent,
      glow: matched.glow,
      trim,
      outline: '#161b26',
      shellLight: '#f1f5f9',
      shellMid: '#cbd5e1',
      shellDark: '#7c8ba1',
      visor: '#172033',
      visorGloss: '#263552',
    };
  }
  const seed = hashString(modelName || String(worker?.worker_id || index));
  const fallbackAccents = [
    ['#38bdf8', '#bae6fd'],
    ['#4ade80', '#bbf7d0'],
    ['#fb923c', '#fed7aa'],
    ['#f472b6', '#fbcfe8'],
    ['#a78bfa', '#ddd6fe'],
  ];
  const [accent, glow] = fallbackAccents[seed % fallbackAccents.length];
  return {
    accent,
    glow,
    trim: EXTRA_TRIMS[seed % EXTRA_TRIMS.length],
    outline: '#161b26',
    shellLight: '#f1f5f9',
    shellMid: '#cbd5e1',
    shellDark: '#7c8ba1',
    visor: '#172033',
    visorGloss: '#263552',
  };
}

function resolveSpriteState(worker) {
  if (!worker) return 'idle';
  const status = worker.status;
  if (status === 'failed') return 'failed';
  if (status === 'completed') return 'completed';
  if (status !== 'running') return 'idle';

  const act = String(worker.activity || '').toLowerCase();
  if (act === 'reviewing' || worker.mode === 'review') return 'reviewing';
  if (act === 'coding' || act === 'exec') return 'coding';
  if (act === 'thinking' || act === 'starting') return 'thinking';
  return 'coding';
}

function getEffortCadence(effort) {
  const e = String(effort || '').toLowerCase();
  if (e === 'xhigh') return 2.0;
  if (e === 'high') return 1.5;
  if (e === 'low') return 0.75;
  return 1.0;
}

function px(ctx, x, y, color, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

function drawRoundedRobotHead(ctx, ox, oy, p) {
  // Top outline (x=7..16, y=5)
  px(ctx, ox + 7, oy + 5, p.outline, 10, 1);
  // Side outlines & ear pods (y=6..11)
  px(ctx, ox + 6, oy + 6, p.outline, 1, 6);
  px(ctx, ox + 17, oy + 6, p.outline, 1, 6);
  px(ctx, ox + 5, oy + 8, p.outline, 1, 3);
  px(ctx, ox + 18, oy + 8, p.outline, 1, 3);
  // Bottom outline (y=12)
  px(ctx, ox + 7, oy + 12, p.outline, 10, 1);

  // Shell fill & subtle shading
  px(ctx, ox + 7, oy + 6, p.shellMid, 10, 6);
  px(ctx, ox + 7, oy + 6, p.shellLight, 10, 1);
  px(ctx, ox + 7, oy + 7, p.shellLight, 1, 4);
  px(ctx, ox + 16, oy + 7, p.shellDark, 1, 4);
  px(ctx, ox + 7, oy + 11, p.shellDark, 10, 1);

  // Visor interior (x=8..15, y=7..10)
  px(ctx, ox + 8, oy + 7, p.visor, 8, 4);
  px(ctx, ox + 8, oy + 7, p.visorGloss, 2, 1);
}

function drawTorso(ctx, ox, oy, p) {
  // Collar / scarf trim (y=13)
  px(ctx, ox + 7, oy + 13, p.outline, 1, 1);
  px(ctx, ox + 8, oy + 13, p.trim, 8, 1);
  px(ctx, ox + 16, oy + 13, p.outline, 1, 1);

  // Body (y=14..18)
  px(ctx, ox + 7, oy + 14, p.outline, 1, 5);
  px(ctx, ox + 16, oy + 14, p.outline, 1, 5);
  px(ctx, ox + 8, oy + 14, p.shellMid, 8, 5);
  px(ctx, ox + 8, oy + 14, p.shellLight, 2, 4);
  px(ctx, ox + 15, oy + 14, p.shellDark, 1, 4);
  // Chest core badge
  px(ctx, ox + 11, oy + 15, p.accent, 2, 2);
}

function drawDeskAndLaptop(ctx, ox, oy, state, frame, p, theme) {
  const isDark = theme === 'dark';
  const deskSurface = isDark ? '#475569' : '#d6b48a';
  const deskEdge = isDark ? '#334155' : '#b88b5a';
  const laptopShell = isDark ? '#1e293b' : '#475569';

  // Desk plank across bottom (y=19..23)
  px(ctx, ox + 2, oy + 19, p.outline, 20, 1);
  px(ctx, ox + 2, oy + 20, deskSurface, 20, 1);
  px(ctx, ox + 2, oy + 21, deskEdge, 20, 2);
  px(ctx, ox + 3, oy + 23, p.outline, 2, 1);
  px(ctx, ox + 19, oy + 23, p.outline, 2, 1);

  if (state === 'reviewing') {
    // Document / code sheet flat on desk center-right
    px(ctx, ox + 9, oy + 18, p.outline, 6, 3);
    px(ctx, ox + 10, oy + 18, '#f8fafc', 4, 2);
    px(ctx, ox + 10, oy + 18, '#64748b', 3, 1);
    px(ctx, ox + 10, oy + 19, '#38bdf8', 2, 1);
    return;
  }

  // Mini laptop monitor angled in center-front (x=8..15, y=16..19)
  px(ctx, ox + 8, oy + 16, p.outline, 8, 4);
  px(ctx, ox + 9, oy + 17, laptopShell, 6, 2);
  if (state === 'coding') {
    // Animated scrolling cyan/emerald code lines on laptop lid & inner screen
    const c1 = frame % 2 === 0 ? '#22d3ee' : '#34d399';
    const c2 = frame % 2 === 1 ? '#a5f3fc' : '#4ade80';
    px(ctx, ox + 9, oy + 17, c1, 4, 1);
    px(ctx, ox + 10, oy + 18, c2, 5, 1);
  } else if (state === 'idle') {
    // Gentle standby dot
    px(ctx, ox + 11, oy + 18, frame % 4 < 2 ? '#64748b' : p.accent, 1, 1);
  } else if (state === 'thinking') {
    px(ctx, ox + 10, oy + 17, '#fbbf24', 2, 1);
    px(ctx, ox + 12, oy + 18, '#fde68a', 2, 1);
  }
}

/**
 * Draw one 24x24 pixel-art Codex bot inside logical 24x24 grid at (ox, oy).
 */
function drawPixelCodexAt(ctx, ox, oy, state, palette, rawTick, effort = 'medium', theme = 'dark') {
  const cadence = getEffortCadence(effort);
  const fTick = Math.floor(rawTick * cadence);
  const frame = fTick % 8;

  // Vertical body bob by animation state
  let headDy = 0;
  if (state === 'idle') {
    headDy = frame === 3 || frame === 4 ? 1 : 0;
  } else if (state === 'thinking') {
    headDy = frame % 4 === 1 ? -1 : frame % 4 === 3 ? 0 : 0;
  } else if (state === 'coding') {
    headDy = frame % 2 === 0 ? 0 : 1;
  } else if (state === 'completed') {
    headDy = frame % 2 === 0 ? -1 : 0;
  } else if (state === 'failed') {
    headDy = frame % 4 >= 2 ? 1 : 0;
  }

  const hy = oy + headDy;

  // 1. Antenna stem + pulsing beacon (y=2..4)
  px(ctx, ox + 11, hy + 3, palette.outline, 2, 2);
  const antennaLit =
    state === 'failed'
      ? frame % 2 === 0
        ? '#ef4444'
        : '#fca5a5'
      : state === 'completed'
        ? '#34d399'
        : state === 'thinking'
          ? frame % 2 === 0
            ? '#fbbf24'
            : '#fef08a'
          : frame % 4 < 2
            ? palette.accent
            : palette.glow;
  px(ctx, ox + 11, hy + 2, antennaLit, 2, 1);
  if (state === 'thinking' && frame % 2 === 0) {
    // Radar side sparks
    px(ctx, ox + 9, hy + 2, '#fde047', 1, 1);
    px(ctx, ox + 14, hy + 2, '#fde047', 1, 1);
  }

  // 2. Head + Torso
  drawRoundedRobotHead(ctx, ox, hy, palette);
  drawTorso(ctx, ox, oy, palette);

  // 3. Animated Eyes inside Visor (x=8..15, y=8..9)
  if (state === 'idle') {
    const blinking = rawTick % 24 === 22 || rawTick % 24 === 23;
    if (blinking) {
      px(ctx, ox + 9, hy + 9, palette.accent, 2, 1);
      px(ctx, ox + 13, hy + 9, palette.accent, 2, 1);
    } else {
      px(ctx, ox + 9, hy + 8, palette.accent, 2, 2);
      px(ctx, ox + 13, hy + 8, palette.accent, 2, 2);
      px(ctx, ox + 9, hy + 8, palette.glow, 1, 1);
      px(ctx, ox + 13, hy + 8, palette.glow, 1, 1);
    }
  } else if (state === 'thinking') {
    const shift = frame % 4 === 1 ? -1 : frame % 4 === 3 ? 1 : 0;
    px(ctx, ox + 9 + shift, hy + 8, palette.accent, 2, 2);
    px(ctx, ox + 13 + shift, hy + 8, palette.accent, 2, 2);
    px(ctx, ox + 9 + shift, hy + 8, '#fef08a', 1, 1);
    px(ctx, ox + 13 + shift, hy + 8, '#fef08a', 1, 1);
  } else if (state === 'coding') {
    // Focused coder visor eyes + tiny glint sweeping
    px(ctx, ox + 9, hy + 8, palette.accent, 2, 2);
    px(ctx, ox + 13, hy + 8, palette.accent, 2, 2);
    px(ctx, ox + 9 + (frame % 2), hy + 8, '#ffffff', 1, 1);
    px(ctx, ox + 13 + (frame % 2), hy + 8, '#ffffff', 1, 1);
  } else if (state === 'reviewing') {
    // Scanning bar across visor
    const scanX = ox + 8 + (frame % 6);
    px(ctx, ox + 9, hy + 8, palette.accent, 2, 2);
    px(ctx, ox + 13, hy + 8, palette.accent, 2, 2);
    px(ctx, scanX, hy + 7, '#a5f3fc', 1, 4);
  } else if (state === 'completed') {
    // Happy ^ ^ eyes in emerald/glow
    px(ctx, ox + 9, hy + 9, '#34d399', 1, 1);
    px(ctx, ox + 10, hy + 8, '#a7f3d0', 1, 1);
    px(ctx, ox + 11, hy + 9, '#34d399', 1, 1);
    px(ctx, ox + 13, hy + 9, '#34d399', 1, 1);
    px(ctx, ox + 14, hy + 8, '#a7f3d0', 1, 1);
    px(ctx, ox + 15, hy + 9, '#34d399', 1, 1);
  } else if (state === 'failed') {
    // Dizzy X X eyes in crimson
    px(ctx, ox + 9, hy + 8, '#ef4444', 1, 1);
    px(ctx, ox + 11, hy + 8, '#ef4444', 1, 1);
    px(ctx, ox + 10, hy + 9, '#fca5a5', 1, 1);
    px(ctx, ox + 9, hy + 10, '#ef4444', 1, 1);
    px(ctx, ox + 11, hy + 10, '#ef4444', 1, 1);

    px(ctx, ox + 13, hy + 8, '#ef4444', 1, 1);
    px(ctx, ox + 15, hy + 8, '#ef4444', 1, 1);
    px(ctx, ox + 14, hy + 9, '#fca5a5', 1, 1);
    px(ctx, ox + 13, hy + 10, '#ef4444', 1, 1);
    px(ctx, ox + 15, hy + 10, '#ef4444', 1, 1);
  }

  // 4. Arms & Foreground Props
  if (state === 'completed') {
    // Standing feet + celebratory alternating raised arms!
    px(ctx, ox + 8, oy + 19, palette.outline, 3, 2);
    px(ctx, ox + 13, oy + 19, palette.outline, 3, 2);
    px(ctx, ox + 9, oy + 19, palette.shellDark, 2, 1);
    px(ctx, ox + 13, oy + 19, palette.shellDark, 2, 1);

    const leftUp = frame % 2 === 0;
    const rightUp = frame % 2 === 1;
    // Left arm
    px(ctx, ox + 5, oy + (leftUp ? 10 : 14), palette.outline, 2, 4);
    px(ctx, ox + 5, oy + (leftUp ? 11 : 15), palette.shellLight, 1, 2);
    // Right arm
    px(ctx, ox + 17, oy + (rightUp ? 10 : 14), palette.outline, 2, 4);
    px(ctx, ox + 18, oy + (rightUp ? 11 : 15), palette.shellLight, 1, 2);

    // Floating green pixel checkmark ✓ & gold stars
    const bob = frame % 2 === 0 ? 0 : -1;
    px(ctx, ox + 19, oy + 3 + bob, '#10b981', 1, 1);
    px(ctx, ox + 20, oy + 4 + bob, '#34d399', 1, 1);
    px(ctx, ox + 21, oy + 3 + bob, '#34d399', 1, 1);
    px(ctx, ox + 22, oy + 2 + bob, '#34d399', 1, 1);
    if (frame % 2 === 0) {
      px(ctx, ox + 2, oy + 3, '#fbbf24', 1, 1);
      px(ctx, ox + 3, oy + 2, '#fde047', 1, 1);
      px(ctx, ox + 21, oy + 6, '#fbbf24', 1, 1);
    } else {
      px(ctx, ox + 3, oy + 4, '#fbbf24', 1, 1);
      px(ctx, ox + 1, oy + 5, '#fde047', 1, 1);
    }
    return;
  }

  if (state === 'failed') {
    // Drooped arms + red ! badge + pixel smoke puffs
    px(ctx, ox + 5, oy + 14, palette.outline, 2, 5);
    px(ctx, ox + 5, oy + 15, palette.shellDark, 1, 3);
    px(ctx, ox + 17, oy + 14, palette.outline, 2, 5);
    px(ctx, ox + 18, oy + 15, palette.shellDark, 1, 3);

    // Feet
    px(ctx, ox + 8, oy + 19, palette.outline, 3, 2);
    px(ctx, ox + 13, oy + 19, palette.outline, 3, 2);

    // Pulsing red exclamation mark at top right
    if (frame % 2 === 0) {
      px(ctx, ox + 20, oy + 2, '#ef4444', 2, 3);
      px(ctx, ox + 20, oy + 6, '#ef4444', 2, 1);
    } else {
      px(ctx, ox + 20, oy + 1, '#dc2626', 2, 3);
      px(ctx, ox + 20, oy + 5, '#fca5a5', 2, 1);
    }
    // Rising smoke pixel puffs
    const sShift = frame % 4;
    px(ctx, ox + 3, oy + (5 - sShift), '#94a3b8', 2, 1);
    px(ctx, ox + 2, oy + (3 - (sShift % 3)), '#cbd5e1', 1, 1);
    return;
  }

  // Desk states (idle, thinking, coding, reviewing)
  if (state === 'coding') {
    // Alternating rapid hands over desk/keyboard
    const lDy = frame % 2 === 0 ? 1 : 0;
    const rDy = frame % 2 === 1 ? 1 : 0;
    px(ctx, ox + 5, oy + 14, palette.outline, 2, 3);
    px(ctx, ox + 6, oy + 16 + lDy, palette.shellLight, 2, 2);
    px(ctx, ox + 17, oy + 14, palette.outline, 2, 3);
    px(ctx, ox + 16, oy + 16 + rDy, palette.shellLight, 2, 2);

    // Flying pixel sparks near keyboard / antenna
    if (frame % 4 === 0) {
      px(ctx, ox + 4, oy + 14, '#fbbf24', 1, 1);
      px(ctx, ox + 19, oy + 13, palette.accent, 1, 1);
    } else if (frame % 4 === 2) {
      px(ctx, ox + 3, oy + 12, palette.glow, 1, 1);
      px(ctx, ox + 20, oy + 15, '#fbbf24', 1, 1);
    }
  } else if (state === 'reviewing') {
    // Left arm rests on desk; right arm sweeps magnifying glass
    px(ctx, ox + 5, oy + 14, palette.outline, 2, 4);
    px(ctx, ox + 6, oy + 17, palette.shellLight, 2, 1);
    px(ctx, ox + 17, oy + 14, palette.outline, 2, 3);

    const magX = ox + 15 + (frame % 4 <= 2 ? frame % 4 : 1);
    const magY = oy + 13;
    // Handle + lens rim + cyan glass highlight
    px(ctx, magX, magY + 3, '#d97706', 1, 2);
    px(ctx, magX + 1, magY, palette.outline, 4, 4);
    px(ctx, magX + 2, magY + 1, '#38bdf8', 2, 2);
    px(ctx, magX + 2, magY + 1, '#e0f2fe', 1, 1);
  } else {
    // Idle or Thinking: relaxed arms near desk
    px(ctx, ox + 5, oy + 14, palette.outline, 2, 4);
    px(ctx, ox + 5, oy + 15, palette.shellLight, 1, 2);
    px(ctx, ox + 17, oy + 14, palette.outline, 2, 4);
    px(ctx, ox + 18, oy + 15, palette.shellLight, 1, 2);
  }

  drawDeskAndLaptop(ctx, ox, oy, state, frame, palette, theme);

  // Floating lightbulb & thought dots for thinking
  if (state === 'thinking') {
    const bulbY = oy + (frame % 2 === 0 ? 1 : 2);
    // Small rising dots leading up to bulb
    px(ctx, ox + 17, oy + 6, '#94a3b8', 1, 1);
    px(ctx, ox + 19, oy + 5, '#cbd5e1', 1, 1);
    // Lightbulb
    px(ctx, ox + 20, bulbY, '#fbbf24', 3, 2);
    px(ctx, ox + 21, bulbY, '#fef9c3', 1, 1);
    px(ctx, ox + 21, bulbY + 2, '#94a3b8', 1, 1);
    if (frame % 2 === 0) {
      px(ctx, ox + 19, bulbY, '#fde047', 1, 1);
      px(ctx, ox + 23, bulbY, '#fde047', 1, 1);
      px(ctx, ox + 21, bulbY - 1, '#fde047', 1, 1);
    }
  }
}

/**
 * Draw a single crisp 24x24 pixel sprite onto a 48x48 (scale=2) worker card canvas.
 */
function drawWorkerSprite(canvas, state, palette, rawTick, effort = 'medium', theme = 'dark') {
  if (!canvas) return;
  const scale = 2;
  const targetW = 24 * scale;
  const targetH = 24 * scale;
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, targetW, targetH);
  ctx.scale(scale, scale);
  drawPixelCodexAt(ctx, 0, 0, state, palette, rawTick, effort, theme);
  ctx.restore();
}

const STAGE_BADGE_MAP = {
  idle: { text: 'IDLE', bg: '#475569', fg: '#f8fafc' },
  thinking: { text: 'THINK', bg: '#d97706', fg: '#fffbeb' },
  coding: { text: 'CODE', bg: '#0891b2', fg: '#ecfeff' },
  reviewing: { text: 'REV', bg: '#7c3aed', fg: '#f5f3ff' },
  completed: { text: 'DONE', bg: '#059669', fg: '#ecfdf5' },
  failed: { text: 'FAIL', bg: '#dc2626', fg: '#fef2f2' },
};

function shortModelLabel(model) {
  if (!model) return 'codex';
  const s = String(model).replace(/^gpt-/i, '');
  return s.length > 9 ? s.slice(0, 9) : s;
}

/**
 * Draw the multi-Codex Pixel Workshop Stage showing up to 5 sprites side-by-side.
 * Returns clickable hitboxes in CSS pixel coordinates: [{workerId, x, y, w, h}].
 */
function drawWorkshopStage(canvas, workers, opts, rawTick) {
  if (!canvas) return [];
  const { theme = 'dark', previewState = null, selectedWorkerId = null } = opts || {};
  const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  const cssW = Math.max(260, Math.floor(canvas.clientWidth || 340));
  const cssH = 128;

  if (canvas.width !== Math.floor(cssW * dpr) || canvas.height !== Math.floor(cssH * dpr)) {
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.height = `${cssH}px`;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return [];

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = false;

  const isDark = theme === 'dark';
  // Pixel studio background
  ctx.fillStyle = isDark ? '#0f172a' : '#f1f5f9';
  ctx.fillRect(0, 0, cssW, cssH);

  // Subtle retro blueprint grid lines
  ctx.fillStyle = isDark ? 'rgba(148, 163, 184, 0.08)' : 'rgba(15, 23, 42, 0.06)';
  for (let gx = 16; gx < cssW; gx += 16) {
    ctx.fillRect(gx, 0, 1, cssH - 28);
  }
  for (let gy = 16; gy < cssH - 28; gy += 16) {
    ctx.fillRect(0, gy, cssW, 1);
  }

  // Pixel window on top-left wall
  const winW = 28;
  const winH = 20;
  ctx.fillStyle = isDark ? '#1e293b' : '#cbd5e1';
  ctx.fillRect(10, 8, winW, winH);
  ctx.fillStyle = isDark ? '#0b1220' : '#bae6fd';
  ctx.fillRect(12, 10, winW - 4, winH - 4);
  if (isDark) {
    ctx.fillStyle = '#fde68a';
    ctx.fillRect(16, 13, 2, 2);
    ctx.fillStyle = rawTick % 12 < 6 ? '#f8fafc' : '#94a3b8';
    ctx.fillRect(28, 16, 2, 2);
    ctx.fillRect(22, 20, 1, 1);
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(16, 14, 6, 3);
    ctx.fillRect(25, 17, 5, 2);
  }

  // Studio floor strip
  ctx.fillStyle = isDark ? '#1e293b' : '#e2e8f0';
  ctx.fillRect(0, cssH - 28, cssW, 28);
  ctx.fillStyle = isDark ? '#334155' : '#cbd5e1';
  ctx.fillRect(0, cssH - 28, cssW, 2);

  // Determine cast of bots to render on stage
  let cast = [];
  if (previewState) {
    cast = [
      {
        worker_id: '__preview__',
        model: 'gpt-6.2-sol',
        reasoning_effort: 'high',
        status: previewState === 'completed' ? 'completed' : previewState === 'failed' ? 'failed' : previewState === 'idle' ? 'idle' : 'running',
        activity: previewState,
        _forcedState: previewState,
      },
    ];
  } else {
    const running = (workers || []).filter((w) => w.status === 'running');
    if (running.length > 0) {
      cast = running.slice(0, 5);
    } else if (workers && workers.length > 0) {
      cast = workers.slice(0, Math.min(4, workers.length));
    } else {
      cast = [
        {
          worker_id: '__standby__',
          model: 'codex',
          reasoning_effort: 'medium',
          status: 'idle',
          activity: 'idle',
          _forcedState: 'idle',
        },
      ];
    }
  }

  const slotCount = cast.length;
  const scale = slotCount >= 5 ? 2 : 3;
  const spritePx = 24 * scale;
  const maxSlotW = Math.floor((cssW - 24) / Math.max(1, slotCount));
  const spacing = Math.min(108, Math.max(spritePx + 10, maxSlotW));
  const totalSpan = spacing * (slotCount - 1) + spritePx;
  const startX = Math.max(12, Math.floor((cssW - totalSpan) / 2));
  const spriteTopY = cssH - 28 - spritePx + 2;

  const hitboxes = [];
  cast.forEach((worker, idx) => {
    const drawX = startX + idx * spacing;
    const palette = getPaletteForWorker(worker, idx);
    const state = worker._forcedState || resolveSpriteState(worker);
    const isSelected = selectedWorkerId && worker.worker_id === selectedWorkerId;

    if (isSelected) {
      ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.14)' : 'rgba(14, 165, 233, 0.14)';
      ctx.fillRect(drawX - 4, spriteTopY - 6, spritePx + 8, spritePx + 26);
      ctx.strokeStyle = palette.accent;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(drawX - 4, spriteTopY - 6, spritePx + 8, spritePx + 26);
    }

    ctx.save();
    ctx.translate(drawX, spriteTopY);
    ctx.scale(scale, scale);
    drawPixelCodexAt(ctx, 0, 0, state, palette, rawTick + idx * 3, worker.reasoning_effort, theme);
    ctx.restore();

    // Crisp status tag + short model caption beneath each character on studio floor
    const badge = STAGE_BADGE_MAP[state] || STAGE_BADGE_MAP.idle;
    const centerX = drawX + spritePx / 2;
    ctx.font = '700 9px ui-monospace, SFMono-Regular, Menlo, monospace';
    const labelText = `${badge.text} ${shortModelLabel(worker.model)}`;
    const textW = Math.ceil(ctx.measureText(labelText).width);
    const pillW = textW + 8;
    const pillX = Math.max(2, Math.min(cssW - pillW - 2, Math.round(centerX - pillW / 2)));
    const pillY = cssH - 20;

    ctx.fillStyle = badge.bg;
    ctx.fillRect(pillX, pillY, pillW, 14);
    ctx.fillStyle = badge.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, pillX + pillW / 2, pillY + 7);

    if (worker.worker_id && !worker.worker_id.startsWith('__')) {
      hitboxes.push({
        workerId: worker.worker_id,
        x: drawX - 4,
        y: spriteTopY - 4,
        w: spritePx + 8,
        h: spritePx + 24,
      });
    }
  });

  ctx.restore();
  return hitboxes;
}

globalThis.CodexSprites = {
  ANIMATION_STATES,
  getPaletteForWorker,
  resolveSpriteState,
  getEffortCadence,
  drawPixelCodexAt,
  drawWorkerSprite,
  drawWorkshopStage,
};
})();
