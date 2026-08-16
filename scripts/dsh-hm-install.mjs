#!/usr/bin/env node
/**
 * dsh-hm-install.mjs — HarmonyOS (openharmony) in-tree plugin installer.
 *
 * dshmarket's install route normally runs `dsh plugin add github:owner/repo`,
 * which pnpm resolves through `git ls-remote` — impossible on this box (the
 * isogit shim lacks ls-remote) — and would clone into pnpm's store where a
 * plugin's @deepseek-ai/* imports cannot resolve. Instead we download the
 * source tarball, place the plugin inside the profile tree (plugins-src/),
 * symlink it into the profile's node_modules, and register it in the profile
 * manifest. The result mirrors what dshmarket's own post-install validation
 * (hasDshManifest / entryArtifactExists) expects, so the market reports a
 * clean success and the next dsh boot loads the plugin.
 *
 * Source-only plugins (no prebuilt JS entry) are built in place first: pnpm
 * workspaces get `pnpm --pm-on-fail=ignore install` + the build script (the
 * supply-chain age gate is relaxed in the discarded temp checkout), single
 * packages get `npm install` + build/tsc. Success is judged by whether the
 * entry artifact exists afterwards, not by the build script's exit code.
 *
 * Pure node: uses fetch, tar (system), and fs. The install itself never
 * touches pnpm's store; auto-builds above use npm/pnpm as child processes.
 *
 * Usage: node dsh-hm-install.mjs <profileDir> <github:owner/repo[#ref][#path:/sub]>
 * Prints one JSON result object on stdout.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync, rmSync,
  symlinkSync, readdirSync, statSync, renameSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, relative, basename } from 'node:path';

const [profileDir, target] = process.argv.slice(2);

if (!profileDir || !target || !target.startsWith('github:')) {
  console.log(JSON.stringify({ ok: false, error: 'usage: node dsh-hm-install.mjs <profileDir> <github:owner/repo[...]>' }));
  process.exit(0);
}

const PLUGINS_SRC = join(profileDir, 'plugins-src');
const log = (...a) => console.error('[hm-install]', ...a);
const finish = (payload) => { console.log(JSON.stringify(payload)); process.exit(0); };
const fail = (error) => finish({ ok: false, error });

/** Parse `github:owner/repo#ref#path:/sub` into parts. */
function parseTarget(t) {
  let pathSel = null;
  let rest = t;
  const pi = t.indexOf('#path:');
  if (pi !== -1) { pathSel = t.slice(pi + '#path:'.length); rest = t.slice(0, pi); }
  let ref = null;
  const hi = rest.indexOf('#');
  if (hi !== -1) { ref = rest.slice(hi + 1); rest = rest.slice(0, hi); }
  const m = /^github:([^/\s]+)\/([^/\s]+)$/.exec(rest);
  if (!m) return null;
  return { owner: m[1], repo: m[2], ref, pathSel };
}

/** Mirrors dshmarket profile.js hasDshManifest: `manifest.dsh` must exist. */
function hasDshManifest(dir) {
  try { return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).dsh !== undefined; }
  catch { return false; }
}

/** Candidate host entry paths from main / exports["."]. */
function entryCandidates(dir) {
  const m = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const cands = [];
  if (typeof m.main === 'string') cands.push(m.main);
  const rootExp = typeof m.exports === 'string' ? m.exports : m.exports?.['.'];
  if (typeof rootExp === 'string') cands.push(rootExp);
  else if (rootExp && typeof rootExp === 'object') for (const v of Object.values(rootExp)) if (typeof v === 'string') cands.push(v);
  if (cands.length === 0) cands.push('index.js');
  return cands;
}

/**
 * The host entry artifact must already exist AND be plain JS. A missing or
 * .ts main means the checkout ships source only and needs a compiler — which
 * this box does not have — so such a plugin is uninstallable.
 */
function resolveEntry(dir) {
  for (const rel of entryCandidates(dir)) {
    const abs = join(dir, rel);
    if (existsSync(abs) && /\.(?:m?js|cjs)$/.test(abs)) return rel;
  }
  return null;
}

/**
 * The declared entry (main / exports["."]) often points at a bundler artifact
 * (e.g. tsdown's lib/index.js) that needs native rolldown bindings this box
 * cannot run. tsc -b still emits plain JS to the tsconfig outDir. When the
 * declared entry is missing but a tsc-emitted entry exists, rewrite main and
 * exports["."] to point at it so the plugin can load as-is.
 */
function retargetToTscOut(pluginDir) {
  let outDir = null;
  try {
    const ts = JSON.parse(readFileSync(join(pluginDir, 'tsconfig.json'), 'utf8'));
    outDir = ts?.compilerOptions?.outDir ?? null;
  } catch { return false; }
  if (!outDir) return false;
  const emitted = join(pluginDir, outDir, 'index.js');
  if (!existsSync(emitted)) return false;
  const pjPath = join(pluginDir, 'package.json');
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  const rel = join(outDir, 'index.js').replace(/\\/g, '/');
  pj.main = rel;
  const exp = pj.exports ?? {};
  const dot = exp['.'];
  if (typeof dot === 'string') exp['.'] = './' + rel;
  else if (dot && typeof dot === 'object') {
    exp['.'] = { ...dot, default: './' + rel, import: './' + rel, require: './' + rel };
  } else {
    exp['.'] = './' + rel;
  }
  pj.exports = exp;
  writeFileSync(pjPath, `${JSON.stringify(pj, null, 2)}\n`);
  return true;
}

/** --- 自动编译 (auto-build): best-effort build of source-only plugins --- */

const BUILD_INSTALL_MS = 8 * 60 * 1000; // pnpm/npm install budget
const BUILD_SCRIPT_MS = 5 * 60 * 1000;  // build script budget

/** Resolve a tool on PATH, falling back to known HarmonyOS install dirs. */
function toolBin(name) {
  try {
    const r = spawnSync('sh', ['-c', `command -v ${name}`], { encoding: 'utf8' });
    const p = r.stdout?.trim?.();
    if (p) return p;
  } catch { /* fall through */ }
  const home = homedir();
  for (const c of [
    join(home, '.npm-global', 'bin', name),
    '/data/service/hnp/node.org/node_v24.13.0/bin/' + name,
    join(home, 'node-v22.14.0-linux-arm64', 'bin', name),
  ]) if (existsSync(c)) return c;
  return name;
}

/** Run one child command with a timeout; returns {ok, code, output}. */
function runCmd(file, args, timeoutMs, cwd, env = {}) {
  const r = spawnSync(file, args, {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: 'true', ...env },
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(-16 * 1024);
  if (r.error) return { ok: false, code: r.status ?? null, output: output || String(r.error.message) };
  return { ok: r.status === 0, code: r.status, output };
}

function tail(s, n = 400) {
  s = String(s ?? '');
  return s.length > n ? `…${s.slice(-n)}` : s;
}

/**
 * pnpm on this box is the standalone @pnpm/exe build; every invocation must
 * skip its native-binary identity check or it refuses to run inside a project
 * whose lockfile lacks the openharmony-arm64 exe entry. The npm-style config
 * env var is set so NESTED pnpm processes (scripts that re-invoke pnpm, e.g.
 * `pnpm -r run build`) inherit the bypass too — a bare `--pm-on-fail` flag only
 * covers the outer process.
 */
function pnpmCmd(pnpm, args, timeoutMs, cwd) {
  return runCmd(pnpm, ['--pm-on-fail=ignore', ...args], timeoutMs, cwd, { npm_config_pm_on_fail: 'ignore' });
}

/** Remove a top-level YAML key plus its indented continuation block. */
function stripYamlKey(txt, key) {
  const lines = txt.split('\n');
  const out = [];
  let skip = false;
  for (const line of lines) {
    const m = /^([\w-]+)\s*:/.exec(line);
    if (!skip && m && m[1] === key) { skip = true; continue; }
    if (skip) {
      const indent = /^\s*/.exec(line)?.[0].length ?? 0;
      if (indent > 0) continue; // still inside the value block
      skip = false;
    }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Patch an EXTRACTED temp checkout so pnpm works on this box. The checkout is
 * discarded after this install, so nothing here protects real state:
 *  - remove the `packageManager` field: it makes the @pnpm/exe standalone run
 *    its native-binary identity check, which always fails on openharmony-arm64
 *    (the platform binding is absent from the lockfile) — even for NESTED pnpm
 *    processes spawned by build scripts, which a CLI flag cannot cover;
 *  - neutralize the root `prepare` script (often `pnpm run build`): pnpm runs
 *    prepare during the pre-run deps-status-check's implicit `pnpm install`,
 *    which recurses back into build and dies;
 *  - relax supply-chain gates (minimumReleaseAge / unpublished snapshots).
 */
function patchWorkspaceForBuild(root) {
  const wp = join(root, 'pnpm-workspace.yaml');
  if (!existsSync(wp)) return;
  const before = readFileSync(wp, 'utf8');
  let txt = stripYamlKey(before, 'minimumReleaseAge');
  txt = stripYamlKey(txt, 'minimumReleaseAgeExclude');
  if (txt !== before) {
    writeFileSync(wp, txt);
    log(`build: relaxed supply-chain gates in ${wp}`);
  }
  const pjPath = join(root, 'package.json');
  try {
    const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
    let changed = false;
    if (pj.packageManager) { delete pj.packageManager; changed = true; }
    if (pj.scripts?.prepare) { pj.scripts.prepare = 'true'; changed = true; }
    if (changed) {
      writeFileSync(pjPath, `${JSON.stringify(pj, null, 2)}\n`);
      log(`build: removed packageManager, neutralized prepare in ${pjPath}`);
    }
  } catch { /* leave package.json alone */ }
  writeFileSync(join(root, '.npmrc'), 'pm-on-fail=ignore\nverify-deps-before-run=false\n');
}

/**
 * Best-effort build of a source-only plugin. Runs pnpm for workspace/monorepo
 * repos (this box's pnpm standalone needs `--pm-on-fail=ignore` to skip its
 * native-binary identity check), otherwise npm. Success is judged by whether
 * the entry artifact now exists — a script's non-zero exit is tolerated when
 * tsc already emitted the entry before a later native step (tsdown/esbuild)
 * failed.
 */
function tryBuildPlugin(pluginDir, repoTop) {
  const m = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
  const name = m.name;
  for (let d = pluginDir; d && d.startsWith(repoTop); d = dirname(d)) {
    if (!existsSync(join(d, 'pnpm-workspace.yaml'))) continue;
    const wpRoot = d;
    patchWorkspaceForBuild(wpRoot);
    const pnpm = toolBin('pnpm');
    log(`build: pnpm install @ ${wpRoot}`);
    let r = pnpmCmd(pnpm, ['install'], BUILD_INSTALL_MS, wpRoot);
    if (!r.ok) {
      // Freshly-published lockfile pins may trip the age/unpublished gates.
      r = pnpmCmd(pnpm, ['install', '--config.minimumReleaseAge=0', '--config.allowUnpublishedSnapshots=true'], BUILD_INSTALL_MS, wpRoot);
    }
    if (!r.ok) {
      // Native postinstall scripts (koffi/pty/esbuild) fail on this box; tsc
      // only needs installed type packages, not their native side effects.
      r = pnpmCmd(pnpm, ['install', '--ignore-scripts', '--config.minimumReleaseAge=0', '--config.allowUnpublishedSnapshots=true'], BUILD_INSTALL_MS, wpRoot);
    }
    if (!r.ok) throw new Error(`自动编译失败: pnpm install 退出码 ${r.code}。${tail(r.output)}`);
    if (pluginDir === wpRoot && m.scripts?.build) {
      r = pnpmCmd(pnpm, ['run', 'build'], BUILD_SCRIPT_MS, wpRoot);
    } else {
      r = pnpmCmd(pnpm, ['-r', 'run', 'build'], BUILD_SCRIPT_MS, wpRoot);
    }
    if (!r.ok) log(`build: pnpm build 退出码 ${r.code}（入口产物已存在则照常安装）`);
    if (resolveEntry(pluginDir) !== null) return true;
    // Fallback: compile the plugin's own tsconfig directly with the installed
    // typescript (no pnpm wrapper). The recursive build often emits the
    // workspace deps before dying on a later native step, so this tsc usually
    // succeeds on the entry even though the full chain did not.
    const tsc = join(wpRoot, 'node_modules', '.bin', 'tsc');
    if (existsSync(tsc) && existsSync(join(pluginDir, 'tsconfig.json'))) {
      r = runCmd(tsc, ['-p', 'tsconfig.json'], BUILD_SCRIPT_MS, pluginDir);
      if (!r.ok) log(`build: tsc 退出码 ${r.code}`);
      if (resolveEntry(pluginDir) !== null) return true;
    }
    if (pluginDir !== wpRoot) {
      r = pnpmCmd(pnpm, ['--filter', name, 'run', 'build'], BUILD_SCRIPT_MS, wpRoot);
      if (!r.ok) log(`build: pnpm --filter build 退出码 ${r.code}`);
      if (resolveEntry(pluginDir) !== null) return true;
    }
    throw new Error(`自动编译失败: 构建后入口仍不存在。最后输出: ${tail(r.output)}`);
  }
  const npm = toolBin('npm');
  log(`build: npm install @ ${pluginDir}`);
  let r = runCmd(npm, ['install', '--no-audit', '--no-fund'], BUILD_INSTALL_MS, pluginDir);
  if (!r.ok) throw new Error(`自动编译失败: npm install 退出码 ${r.code}。${tail(r.output)}`);
  if (m.scripts?.build) {
    r = runCmd(npm, ['run', 'build'], BUILD_SCRIPT_MS, pluginDir);
    if (!r.ok) log(`build: npm run build 退出码 ${r.code}（入口产物已存在则照常安装）`);
    if (resolveEntry(pluginDir) !== null) return true;
    throw new Error(`自动编译失败: npm run build 后入口仍不存在。${tail(r.output)}`);
  }
  r = runCmd(npm, ['exec', '--yes', '--', 'tsc', '-p', 'tsconfig.json'], BUILD_SCRIPT_MS, pluginDir);
  if (!r.ok) log(`build: tsc 退出码 ${r.code}`);
  if (resolveEntry(pluginDir) !== null) return true;
  throw new Error(`自动编译失败: 没有 build 脚本且 tsc 后入口仍不存在。${tail(r.output)}`);
}

/** Locate plugin dirs: explicit #path:, the repo root, or monorepo subdirs (recursive, depth-capped). */
function findPluginDirs(repoDir, pathSel) {
  if (pathSel) {
    const p = join(repoDir, pathSel.replace(/^\//, ''));
    return existsSync(join(p, 'package.json')) ? [p] : [];
  }
  if (existsSync(join(repoDir, 'package.json')) && hasDshManifest(repoDir)) return [repoDir];
  const out = [];
  const MAX_DEPTH = 5;
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.') || name === 'dist') continue;
      const p = join(dir, name);
      let isDir;
      try { isDir = statSync(p).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      if (existsSync(join(p, 'package.json')) && hasDshManifest(p)) {
        out.push(p); // found a plugin; don't descend into its own subtree
      } else {
        walk(p, depth + 1);
      }
    }
  };
  walk(repoDir, 0);
  return out;
}

/**
 * A plugin declaring a web `dsh.client` bundle whose artifact does not exist
 * (e.g. the client needs native tooling like tsdown/rolldown that this box
 * lacks) crashes the whole dsh boot with MissingClientBundleError. Strip the
 * client declaration so the plugin installs as server-only instead.
 */
function stripMissingClient(pluginDir) {
  const pjPath = join(pluginDir, 'package.json');
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  const client = pj.dsh?.client;
  const isWeb = client != null && (client === 'web' || (typeof client === 'object' && client.platform === 'web'));
  if (!isWeb) return false;
  let clientRel = null;
  const ce = pj.exports?.['./client'];
  if (typeof ce === 'string') clientRel = ce;
  else if (ce && typeof ce === 'object') clientRel = ce.default ?? ce.import ?? ce.require ?? null;
  if (clientRel !== null && existsSync(join(pluginDir, clientRel))) return false;
  delete pj.dsh.client;
  if (pj.dsh && Object.keys(pj.dsh).length === 0) delete pj.dsh;
  if (pj.exports) delete pj.exports['./client'];
  writeFileSync(pjPath, `${JSON.stringify(pj, null, 2)}\n`);
  log(`client 包未构建（本机无原生构建工具 tsdown/rolldown），已剥离 dsh.client 安装为仅服务端 / client bundle unbuilt (no native tooling on this box); installed as server-only`);
  return true;
}

/** Place one plugin in-tree, symlink it into node_modules, register in manifest. */
async function installOne(pluginDir, repoTop) {
  const m = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8'));
  const name = m.name;
  if (!name) throw new Error('插件 package.json 缺少 name');
  if (resolveEntry(pluginDir) === null) {
    log(`${name}: 无预编译产物，尝试自动编译… / no prebuilt entry, attempting auto-build`);
    try {
      await tryBuildPlugin(pluginDir, repoTop);
    } catch (e) {
      // tsdown/rolldown 需要原生绑定，本机无法打包；tsc 产物仍在 outDir 下。
      // 入口声明指向打包产物时，改指向 tsc 产物即可加载。
      if (!retargetToTscOut(pluginDir)) throw e;
      log(`构建缺入口（原生打包工具不可用），已把 main 重定向到 tsc 产物 / build entry missing, retargeted main to tsc output`);
    }
  }
  stripMissingClient(pluginDir);
  // The build leaves a node_modules whose symlinks point into the discarded
  // temp checkout. Runtime deps resolve up the profile tree instead; a stale
  // node_modules here would short-circuit resolution with broken links.
  const staleNM = join(pluginDir, 'node_modules');
  if (existsSync(staleNM)) rmSync(staleNM, { recursive: true, force: true });
  const dest = join(PLUGINS_SRC, name);
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true }); // scoped names need the @scope parent
  renameSync(pluginDir, dest);
  const linkPath = join(profileDir, 'node_modules', name);
  if (existsSync(linkPath) || isSymlink(linkPath)) rmSync(linkPath, { recursive: true, force: true });
  mkdirSync(dirname(linkPath), { recursive: true });
  symlinkSync(relative(dirname(linkPath), dest), linkPath, 'dir');
  const manifestPath = join(profileDir, 'package.json');
  const pj = JSON.parse(readFileSync(manifestPath, 'utf8'));
  pj.dependencies = pj.dependencies ?? {};
  if (!(name in pj.dependencies)) pj.dependencies[name] = `link:${dest}`;
  pj.dsh = pj.dsh ?? {};
  pj.dsh.profile = pj.dsh.profile ?? {};
  pj.dsh.profile.bundles = pj.dsh.profile.bundles ?? [];
  if (!pj.dsh.profile.bundles.includes(name)) pj.dsh.profile.bundles.push(name);
  writeFileSync(manifestPath, `${JSON.stringify(pj, null, 2)}\n`);
  log(`installed ${name} -> ${dest}`);
  return name;
}

function isSymlink(p) {
  try { return statSync(p).isSymbolicLink(); } catch { return false; }
}

async function fetchBytes(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'dsh-hm-install/0.1' } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch { return null; }
}

async function defaultBranch(owner, repo) {
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: { 'user-agent': 'dsh-hm-install/0.1' } });
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j.default_branch === 'string' ? j.default_branch : null;
  } catch { return null; }
}

const parsed = parseTarget(target);
if (!parsed) fail(`无法解析 github 源: ${target}`);
const { owner, repo, ref, pathSel } = parsed;

// Fetch the tarball: explicit ref → default branch → main → master.
let buf = null;
let usedRef = null;
const refsToTry = [];
if (ref) refsToTry.push(ref);
const db = await defaultBranch(owner, repo);
if (db && db !== ref) refsToTry.push(db);
if (!refsToTry.includes('main')) refsToTry.push('main');
if (!refsToTry.includes('master')) refsToTry.push('master');
for (const r of refsToTry) {
  log(`fetching codeload ref=${r}`);
  const b = await fetchBytes(`https://codeload.github.com/${owner}/${repo}/tar.gz/${r}`);
  if (b) { buf = b; usedRef = r; break; }
}
if (!buf) fail(`下载失败: github.com/${owner}/${repo}（网络或分支探测失败）`);
log(`downloaded ${owner}/${repo}@${usedRef} (${buf.length} bytes)`);

// Extract under plugins-src so the rename into place stays on one filesystem.
mkdirSync(PLUGINS_SRC, { recursive: true });
const work = join(PLUGINS_SRC, `.hm-work-${Date.now()}`);
const exDir = join(work, 'x');
mkdirSync(exDir, { recursive: true });
try {
  writeFileSync(join(work, 'src.tar.gz'), buf);
  const t = spawnSync('tar', ['-xzf', join(work, 'src.tar.gz'), '-C', exDir], { stdio: 'pipe' });
  if (t.status !== 0) throw new Error(`tar 解压失败: ${String(t.status)} ${t.stderr?.toString?.().slice(0, 200) ?? ''}`);
  const repoTop = readdirSync(exDir)
    .map((e) => join(exDir, e))
    .find((p) => statSync(p).isDirectory() && !basename(p).startsWith('.'));
  if (!repoTop) throw new Error('tar 包内未找到仓库目录');
  const pluginDirs = findPluginDirs(repoTop, pathSel);
  if (pluginDirs.length === 0) throw new Error('源码里没有找到带 dsh 清单的插件 / no plugin with a dsh manifest found');
  const installed = [];
  for (const p of pluginDirs) installed.push(await installOne(p, repoTop));
  finish({ ok: true, installed, ref: usedRef, source: `github:${owner}/${repo}` });
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
} finally {
  rmSync(work, { recursive: true, force: true });
}
