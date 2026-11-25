#!/usr/bin/env node
/** Resolve Python 3.9+ and launch the stdio MCP server. */
import { realpathSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';

const here = new URL('.', import.meta.url);
const script = fileURLToPath(new URL('./codex_mcp_server.py', here));

function safeRealpath(filePath) {
  try {
    return realpathSync(filePath);
  } catch {
    return resolve(filePath);
  }
}

function candidates(env, platformName = platform()) {
  const isWin = platformName === 'win32';
  const result = [];
  const override = (env.CODEX_BRIDGE_PYTHON || '').trim();
  if (override) {
    return [{ command: override, args: isWin && /(^|\\|\/)py(?:\.exe)?$/i.test(override) ? ['-3'] : [] }];
  }
  if (isWin) result.push({ command: 'py', args: ['-3'] });
  for (const name of ['python', 'python3']) result.push({ command: name, args: [] });
  if (platformName === 'darwin') {
    result.push({ command: '/opt/homebrew/bin/python3', args: [] }, { command: '/usr/local/bin/python3', args: [] });
  }
  if (isWin) {
    for (const root of [env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean)) {
      for (const version of ['Python313', 'Python312', 'Python311', 'Python310', 'Python39']) {
        result.push({ command: join(root, 'Programs', 'Python', version, 'python.exe'), args: [] });
        result.push({ command: join(root, version, 'python.exe'), args: [] });
      }
    }
  }
  const seen = new Set();
  return result.filter((candidate) => {
    const key = `${candidate.command}\0${candidate.args.join('\0')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function resolvePython(env = process.env, platformName = platform()) {
  const isWin = platformName === 'win32';
  for (const candidate of candidates(env, platformName)) {
    if (isWin && /[\\/]WindowsApps[\\/]/i.test(candidate.command)) continue;
    const probe = spawnSync(
      candidate.command,
      [...candidate.args, '-c', 'import sys; print("%d.%d" % sys.version_info[:2])'],
      {
        env,
        encoding: 'utf8',
        timeout: 2500,
        windowsHide: true,
        shell: false,
      }
    );
    if (probe.error || probe.status !== 0) continue;
    const match = /^\s*(\d+)\.(\d+)/m.exec(probe.stdout || '');
    if (!match || Number(match[1]) < 3 || (Number(match[1]) === 3 && Number(match[2]) < 9)) continue;
    return { command: candidate.command, args: candidate.args };
  }
  return null;
}

export function launch(argv = process.argv.slice(2), env = process.env) {
  const python = resolvePython(env);
  if (!python) {
    process.stderr.write('codex-bridge: Python 3.9+ was not found. Set CODEX_BRIDGE_PYTHON to a valid interpreter.\n');
    return 1;
  }
  const childEnv = { ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  const serverArgs = [...argv];
  const overrideDataDir = (env.CODEX_BRIDGE_DATA_DIR || '').trim();
  if (overrideDataDir) {
    const index = serverArgs.indexOf('--data-dir');
    if (index !== -1 && index + 1 < serverArgs.length) {
      serverArgs[index + 1] = overrideDataDir;
    }
  }
  const child = spawn(python.command, [...python.args, script, ...serverArgs], {
    env: childEnv,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  });
  let stopping = false;
  const forward = (signal) => {
    if (!child.pid || stopping) return;
    stopping = true;
    try { child.kill(signal); } catch { /* child may already have exited */ }
  };
  const onSigint = () => forward('SIGINT');
  const onSigterm = () => forward('SIGTERM');
  process.on('SIGINT', onSigint);
  process.on('SIGTERM', onSigterm);
  child.on('error', (err) => process.stderr.write(`codex-bridge: failed to start Python: ${err.message}\n`));
  child.on('exit', (code, signal) => {
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    if (signal) process.exitCode = 1;
    else process.exitCode = code ?? 1;
  });
  return null;
}

if (process.argv[1] && safeRealpath(process.argv[1]) === safeRealpath(fileURLToPath(import.meta.url))) {
  const result = launch();
  if (result !== null) process.exitCode = result;
}
