#!/usr/bin/env node
// dsh 核心「检查更新」：check / patch / install / rollback。鸿蒙本机专用，零依赖。
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const HOME = homedir();
const DSH_DIR = join(HOME, 'dsh-test');
const PKG = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'package.json');
const WEB_SH = join(HOME, 'bin', 'dsh-web.sh');
const LOG = join(HOME, 'dsh-update.log');
const PREV = join(HOME, 'dsh-update.prev');
const LOCK = join(HOME, 'dsh-update.lock');
const CRED_FILE = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh-credentials-local', 'lib', 'index.js');
const SESS_FILE = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh-session-persistence-jsonl', 'lib', 'index.js');
const MARK = 'HarmonyOS patch';

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`;
  try { appendFileSync(LOG, line + '\n'); } catch {}
  console.log(parts.join(' '));
}
function tail(s, n = 6000) { return (s || '').slice(-n); }
function readFileSafe(p) { try { return readFileSync(p, 'utf8'); } catch { return ''; } }

function sh(cmd, args, opts = {}) {
  args = args.concat(opts.extra || []);
  const r = spawnSync(cmd, args, {
    encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
    timeout: opts.timeout ?? 600000, cwd: opts.cwd, env: { ...process.env, CI: 'true' },
  });
  return { ok: r.status === 0, code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
// 鸿蒙适配：--ignore-scripts 跳过原生构建（koffi 需 CMake 但本机无编译器，
// 且其原生二进制只在 win32 路径使用、node-pty 本机本就不可用、sharp 走预编译）。
// 纯 JS 的 @deepseek-ai 包均无 install 脚本，忽略是安全的。
function npm(...args) { return sh('npm', args, { cwd: DSH_DIR, extra: ['--ignore-scripts'] }); }

function readInstalled() {
  try { return String(JSON.parse(readFileSync(PKG, 'utf8')).version || '').trim(); }
  catch { return ''; }
}
function getLatest() {
  const r = npm('view', '@deepseek-ai/dsh', 'version');
  if (!r.ok) throw new Error('npm view 失败: ' + tail(r.out));
  return (r.out.trim().split('\n').filter(Boolean).pop() || '').trim();
}
export function check() {
  const installed = readInstalled();
  const latest = getLatest();
  return { installed, latest, upToDate: !!installed && installed === latest };
}

// ---- 幂等补丁 ----
function patchCredentials() {
  const txt = readFileSafe(CRED_FILE);
  if (!txt) throw new Error('credentials 文件不存在，需手动处理: ' + CRED_FILE);
  if (txt.includes(MARK)) return { changed: false };
  const anchor = 'if (process.platform === "win32") return;';
  const stop = '/* v8 ignore stop */';
  const ai = txt.indexOf(anchor);
  if (ai === -1) throw new Error('credentials 补丁锚点缺失(win32 guard)，需手动处理: ' + CRED_FILE);
  const si = txt.indexOf(stop, ai);
  if (si === -1) throw new Error('credentials 补丁锚点缺失(v8 ignore stop)，需手动处理: ' + CRED_FILE);
  const block =
    anchor + '\n' +
    '\t/* HarmonyOS patch: 文件系统强制组位(chmod 600 被拒)，所有者检查在此必然抛错，跳过。 */\n' +
    '\treturn;\n';
  writeFileSync(CRED_FILE, txt.slice(0, ai) + block + txt.slice(si));
  return { changed: true };
}
function patchSession() {
  const txt = readFileSafe(SESS_FILE);
  if (!txt) throw new Error('session 文件不存在，需手动处理: ' + SESS_FILE);
  if (txt.includes(MARK)) return { changed: false };
  const re = /(\t+)await link\(\s*tmp\s*,\s*finalPath\s*\);/;
  const m = re.exec(txt);
  if (!m) throw new Error('session 补丁锚点缺失(await link(tmp, finalPath))，需手动处理: ' + SESS_FILE);
  const indent = m[1];
  const patched = txt.slice(0, m.index) +
    indent + '/* HarmonyOS patch: 本机不支持硬链接(EPERM)，link→rename */\n' +
    indent + 'await rename(tmp, finalPath);' +
    txt.slice(m.index + m[0].length);
  writeFileSync(SESS_FILE, patched);
  return { changed: true };
}
function patchAll() {
  const r1 = patchCredentials(), r2 = patchSession();
  for (const f of [CRED_FILE, SESS_FILE]) {
    if (!readFileSafe(f).includes(MARK)) throw new Error('补丁校验失败(标记缺失): ' + f);
  }
  return { credential: r1.changed, session: r2.changed };
}

// ---- 锁 / 重启 ----
function acquireLock() {
  try { writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; }
  catch { return false; }
}
function releaseLock() { try { unlinkSync(LOCK); } catch {} }

function stopDsh() {
  const r = sh('sh', ['-c', 'ps -ef 2>/dev/null | grep -F "dsh/lib/bin.js" | grep -v grep | awk \'{print $2}\'']);
  const pids = (r.out || '').trim().split(/\s+/).filter(Boolean);
  let n = 0;
  for (const p of pids) {
    const pid = Number(p);
    if (Number.isInteger(pid) && pid > 1) { try { process.kill(pid, 'SIGKILL'); n++; } catch {} }
  }
  return n;
}
function restartDsh() {
  const r = sh('sh', [WEB_SH], { timeout: 60000 });
  if (!r.ok) throw new Error('dsh-web.sh 重启失败: ' + tail(r.out));
}
export async function isUp() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 1500);
    const res = await fetch('http://127.0.0.1:3080/', { signal: ctl.signal });
    clearTimeout(t);
    return res.ok;
  } catch { return false; }
}

// ---- 升级 / 回滚 ----
export async function install() {
  const before = readInstalled();
  const latest = getLatest();
  log('升级: ' + (before || '?') + ' → ' + (latest || '?'));
  if (before === latest && before) log('已是最新，仍重装同版本以修复补丁/产物。');
  const target = latest || before;
  const r = npm('install', '@deepseek-ai/dsh@' + target);
  if (!r.ok) throw new Error('npm install 失败: ' + tail(r.out));
  log('npm install 完成 → ' + target);
  writeFileSync(PREV, before);
  const p = patchAll();
  log('补丁: credential=' + (p.credential ? '重打' : '已存在') + ', session=' + (p.session ? '重打' : '已存在'));
  const killed = stopDsh();
  if (killed > 0) log('已停旧 dsh 进程 ' + killed + ' 个');
  restartDsh();
  if (!(await isUp())) throw new Error('dsh 重启后 3080 未起来，见 ~/dsh-web.log');
  const webLog = readFileSafe(join(HOME, 'dsh-web.log'));
  if (/agent-preset|preset-invalid|preset invalid/i.test(webLog)) {
    log('⚠ dsh 日志出现 preset 报错，harmony-chat 预设可能需重建');
  }
  const installed = readInstalled();
  log('完成: 当前 ' + installed);
  return { ok: true, installed, latest, patched: p };
}
async function rollback(version) {
  const target = version || readFileSafe(PREV).trim();
  if (!target) throw new Error('无回滚目标版本（无 ~/dsh-update.prev）');
  log('回滚到 ' + target);
  const r = npm('install', '@deepseek-ai/dsh@' + target);
  if (!r.ok) throw new Error('npm install 失败: ' + tail(r.out));
  patchAll();
  stopDsh();
  restartDsh();
  if (!(await isUp())) throw new Error('回滚后 3080 未起来');
  return { ok: true, installed: readInstalled() };
}

// ---- 交互 ----
function ask(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(q, (a) => { rl.close(); res(a); }));
}
async function interactive() {
  const c = check();
  console.log('已装 ' + c.installed + ' / 最新 ' + c.latest + '  ' + (c.upToDate ? '✓ 已是最新' : '有更新'));
  if (c.upToDate) { console.log('无需升级。'); return; }
  const a = await ask('是否升级到 ' + c.latest + ' 并重启服务？(y/N) ');
  if (!/^y/i.test(a)) { console.log('已取消。'); return; }
  const r = await install();
  console.log(JSON.stringify(r, null, 2));
}

function die(msg) { console.error('✗ ' + msg); process.exit(1); }

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'check') { console.log(JSON.stringify(check(), null, 2)); return; }
  if (cmd === 'patch') { console.log(JSON.stringify(patchAll(), null, 2)); return; }
  if (cmd === 'install' || cmd === 'update') {
    if (!acquireLock()) return die('另一操作进行中(锁 ' + LOCK + ')');
    try { console.log(JSON.stringify(await install(), null, 2)); } finally { releaseLock(); }
    return;
  }
  if (cmd === 'rollback') {
    if (!acquireLock()) return die('另一操作进行中');
    try { console.log(JSON.stringify(await rollback(process.argv[3]), null, 2)); } finally { releaseLock(); }
    return;
  }
  if (!acquireLock()) return die('另一操作进行中');
  try { await interactive(); } finally { releaseLock(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(() => process.exit(1));
