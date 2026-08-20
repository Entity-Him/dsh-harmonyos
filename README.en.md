[简体中文](README.md) | **English**

# dsh-harmonyos

A complete adaptation suite to get [DeepSeek Harness](https://github.com/deepseek-ai/dsh) (dsh) fully running on **HarmonyOS** devices.

> Almost nobody has done this on HarmonyOS—native ELF/.node modules, node-pty, and Koffi simply cannot load on such devices. This repository distills the whole engineering effort—installation, patching, cache optimization, plugin installation, and self-update—into a reproducible open-source solution.

> **QQ group for project discussion: 930088487** — HarmonyOS dsh adaptation, cache optimization, and plugin development. You're welcome to join.
>
> **Beginner tutorial** (online): [Open the dsh-harmonyos beginner installation tutorial](https://docs.google.com/document/d/1bH07I_Zj5r-kKytnZ7aj6hMTa1c5ZQdE/edit)

> **About this project**: A complete adaptation suite to get DeepSeek Harness (dsh) fully running on HarmonyOS devices. Almost nobody has done this on HarmonyOS—native ELF/.node modules, node-pty, and Koffi cannot load on such devices. This repository distills the whole engineering effort—installation, patching, cache optimization, plugin installation, and self-update—into a reproducible open-source solution:
>
> - **Seven HarmonyOS "conversation mode" Agent presets**: push DeepSeek's prefix cache hit rate to the maximum while retaining task delivery capability—`harmony-chat` (minimal) / `harmony-chat-pro` (cache-optimized) / `harmony-chat-promax` (strongest Hexagon delivery) / `harmony-chat-ops` (resident background task steward) / `harmony-chat-rampagemax` (Rampage Max quality) / `harmony-kb` (knowledge-base expert) / `harmony-deveco` (DevEco full-stack development master)
> - **Hexagon ProMax** (upgraded 2026-08-18): six hard rules in one place—cache hit, token savings, delivery capability, test verification, integration loop, coexistence defense—turning the gap between "code written" and "system running" into a mechanical checklist, with delivery discipline benchmarked against and exceeding mainstream general-purpose Agents
> - **Rampage Max** (added 2026-08-18): an extreme mode that spends token without restraint, prioritizing quality and delivery—runtime context and web fetching fully enabled, exhaustive pre-check scanning, integration loop and double verification written as iron rules. Use with caution: high token consumption, may drain your account quota
> - **Launch patches** `harmony.patch.yml` (web) + `harmony-headless.patch.yml` (headless): disable plugin lines that depend on native binaries, so dsh no longer crashes on startup
> - **node_modules patch scripts**: work around the HarmonyOS filesystem restrictions (`chmod 600` rejected, no hard-link support) + restore the dialog permission presets (`dsh-permission-presets` reads `sandboxMode` from the fs sandbox; the read-only/workspace-write/danger-full-access dropdown is back)
> - **Measured token savings**: an A/B benchmark over 11 tasks verifies `reasoningEffort: high` as Pareto-optimal (all correct + fewest steps + nearly unchanged cost), with the promax delegation group routing complex subtasks to a Pro model as fallback
> - **Five-preset benchmark (2026-08-18)**: after static persona padding (prefix crosses the 128-token chunk boundary), the static-prefix presets' cache hit rate rose from 52.9%–89.9% to **93.8%–98.0%** (promax 96.7%, ops 97.9%, rampagemax 98.0%), and even harmony-chat with runtime context enabled was pulled up to 93.8%—data confirming that "to preserve the cache, keep the prefix stable first" (see "Performance Benchmarks" below)
> - **Toolchain**: one-click GitHub plugin installer, dsh self-updater + settings page

- **Seven HarmonyOS "conversation mode" Agent presets**: push DeepSeek's prefix cache hit rate to the maximum while retaining task delivery capability—`harmony-chat` (minimal) / `harmony-chat-pro` (cache-optimized) / `harmony-chat-promax` (strongest Hexagon delivery) / `harmony-chat-ops` (resident background task steward) / `harmony-chat-rampagemax` (Rampage Max quality) / `harmony-kb` (knowledge-base expert) / `harmony-deveco` (DevEco full-stack development master)
- **Hexagon ProMax** (upgraded 2026-08-18): six hard rules in one place—cache hit, token savings, delivery capability, test verification, integration loop, coexistence defense—turning the gap between "code written" and "system running" into a mechanical checklist, with delivery discipline benchmarked against and exceeding mainstream general-purpose Agents
- **Rampage Max** (added 2026-08-18): an extreme mode that spends token without restraint, prioritizing quality and delivery—runtime context and web fetching fully enabled, exhaustive pre-check scanning, integration loop and double verification written as iron rules. Use with caution: high token consumption, may drain your account quota
- **HarmonyOS Dev Master `harmony-deveco`** (added 2026-08-20): a DevEco full-stack development agent—drives hvigor/ohpm/hdc through the dev_* tools to close the "write ArkTS → build → deploy to device → launch" loop (including signing/packaging guidance); `dev_code` delegates deep sub-tasks to the local DevEco Code agent (OpenCode web, 127.0.0.1:4096). Kirin X90 software-hardware-coordinated power discipline: serialized delegation, never saturating the 4 cores
- **Launch patches** `harmony.patch.yml` (web) + `harmony-headless.patch.yml` (headless): disable plugin lines that depend on native binaries, so dsh no longer crashes on startup
- **node_modules patch scripts**: work around the HarmonyOS filesystem restrictions (`chmod 600` rejected, no hard-link support) + restore the dialog permission presets (`dsh-permission-presets` reads `sandboxMode` from the fs sandbox; the read-only/workspace-write/danger-full-access dropdown is back)
- **Measured token savings**: an A/B benchmark over 11 tasks verifies `reasoningEffort: high` as Pareto-optimal (all correct + fewest steps + nearly unchanged cost), with the promax delegation group routing complex subtasks to a Pro model as fallback
- **Five-preset benchmark (2026-08-18)**: after static persona padding (prefix crosses the 128-token chunk boundary), the static-prefix presets' cache hit rate rose from 52.9%–89.9% to **93.8%–98.0%** (promax 96.7%, ops 97.9%, rampagemax 98.0%), and even harmony-chat with runtime context enabled was pulled up to 93.8%—data confirming that "to preserve the cache, keep the prefix stable first" (see "Performance Benchmarks" below)
- **Toolchain**: one-click GitHub plugin installer, dsh self-updater + settings page

---

## Why This Suite Is Needed

| HarmonyOS device limitation | Consequence | Solution in this repo |
|---|---|---|
| Cannot load native ELF / `.node` modules | `node-pty` (subprocess), `Koffi` (sandbox/fs-local) crash on startup | `harmony.patch.yml` disables these plugin lines |
| Filesystem enforces group permission bits, `chmod 600` is rejected | Credential file permission check always fails; cannot configure an API key | Patch `dsh-credentials-local`: `assertOwnerOnly` returns immediately |
| Filesystem does not support hard links | Session persistence `link()` emits `EPERM` in release logs | Patch `dsh-session-persistence-jsonl`: `link` changed to `rename` |
| No bash shell on HarmonyOS (native sandbox deps disabled) | No permission-preset dropdown in the dialog (read-only/workspace-write/danger-full-access) | Patch `dsh-permission-presets`: read `sandboxMode` from the fs sandbox (pure JS, always running) |
| `git ls-remote` is intercepted by the isogit shim | GitHub-source plugins cannot be installed | `scripts/dsh-hm-install.mjs` installer (fetch source → build → symlink) |

---

## Security Statement

Everything in this repository is plain-text / pure-JS configuration and scripts. It does **not delete, encrypt, or transmit your data, does not register system services, and does not require root**. Safe to use:

- **Pure JS / plain text**: presets are YAML config files, patches are YAML overlay layers, plugins are zero-dependency pure JS (only `node:fs/promises`), scripts are Node/Shell text. No executable binaries, native `.node`/ELF modules, kernel modifications, or drivers.
- **No system-level changes**: does not register `systemd` / autostart / system scheduled tasks, does not modify system paths, does not require root. All writes occur within the dsh installation directory and the `~/.dsh` user config directory.
- **Your data is untouched**: presets only modify dsh's "conversation mode" config; plugins only enumerate directories and read files; patches only enable/disable dsh's own plugin lines. Your files are never deleted, overwritten, encrypted, or transmitted.
- **Minimal network behavior**: only loads config when dsh starts and only accesses the official DeepSeek and GitHub APIs when you actively start a conversation or check for updates. No telemetry, no tracking, no data reporting.
- **Fully auditable**: the entire repository contains just over 20 text files; every single line can be opened and inspected.
- **Reversible uninstall**: delete `~/.dsh/.agent-presets/harmony-chat-ops/`, `~/dsh-test/node_modules/@deepseek-ai/dsh-tool-list/`, and the corresponding profile-layer symlinks, then restart dsh to fully restore.

---

## Quick Start

### 1. Install dsh

```bash
cd ~/dsh-test && npm install @deepseek-ai/dsh
```

> The install location can be overridden with the `DSH_DIR` environment variable; the default `~/dsh-test` is used below.

### 2. Deploy the presets (conversation modes)

Copy the seven mode directories into dsh's user preset directory:

```bash
mkdir -p ~/.dsh/.agent-presets
cp -r presets/* ~/.dsh/.agent-presets/
```

Then set the default conversation mode to one of them in `~/.dsh/settings.yaml`:

```yaml
agent-presets:
  default: harmony-chat-promax
```

All seven modes can be freely switched at any time in the "conversation mode" dropdown of dsh's settings panel (switching only affects new sessions). See [docs/CACHE-OPTIMIZATION.en.md](docs/CACHE-OPTIMIZATION.en.md) for why they are fast.

| Mode | persona | Cache strategy | Tool set |
|---|---|---|---|
| `harmony-chat` (base) | Normal | Runtime context enabled (prefix varies) | Single Agent |
| `harmony-chat-pro` (cache-optimized) | `complete:true` unique prompt section | Zero prefix change, maximum hit rate | Single Agent, planning discipline built in |
| `harmony-chat-promax` (strongest Hexagon delivery) | `complete:false` | Runtime context disabled, long stable prefix | + Subagents / workflows / Ralph delegation group + six hard delivery rules |
| `harmony-chat-ops` (task steward) | Resident background task steward | Runtime context disabled, stable prefix | + Scheduled tasks (schedule_create/list/delete) + directory enumeration (list_dir) |
| `harmony-chat-rampagemax` (Rampage Max) | No token savings, quality and delivery first | Runtime context enabled (prefix varies) + web fetching fully enabled | + Delegation group (all Pro) + exhaustive pre-check / double verification / retrospective iron rules |
| `harmony-chat-rampagemax` (Rampage Max, use with caution) | No token savings, quality and delivery first | **Runtime context enabled**, dynamic prefix, low hit rate | All promax capabilities + web fetch fully enabled + double verification/cross-checking + full-Pro delegation + exhaustive pre-check scan |
| `harmony-kb` (knowledge-base expert) | Workspace-as-knowledge-base: layered retrieval / deep research / doc organization / mind maps / notes | Runtime context disabled, stable prefix | + directory enumeration (list_dir) + Obsidian wikilink note push |
| `harmony-deveco` (Dev Master) | HarmonyOS DevEco full-stack development (write ArkTS → build → deploy → launch) | Runtime context disabled, stable prefix | + dev_environment/build/install_deps/list_devices/deploy + dev_code (delegate to local DevEco Code agent) + Kirin X90 power discipline |

### 2.4 Hexagon ProMax: the ceiling of delivery capability on HarmonyOS

`harmony-chat-promax` does not trade off between "cache hit" and "delivery capability"; instead it applies six hard rules in one place—each one distilled from a real pitfall encountered in practice:

| # | Dimension | Rule | Failure mode it guards against |
|---|---|---|---|
| 1 | **Cache hit** | `includeRuntimeContext:false`; system prompt fully static, zero prefix change | Prefix varies dynamically with the session, DeepSeek's cache hit rate bottoms out (uncached input is roughly **30×** more expensive) |
| 2 | **Token savings** | Static prefix + task tiering: light tasks completed directly without a plan; only heavy tasks run the full loop | Turning even simple Q&A into plans/multiple round trips, wasting output |
| 3 | **Delivery capability** | Keep all prompt sections (planning strategy / tool guidance / delegation group), only disable runtime context | Trimming into a thin shell to preserve the cache, heavy tasks cannot be delivered |
| 4 | **Test verification** | "Before claiming done, you must run verification commands and obtain real output; no evidence equals not done" | Claiming done right after writing code, with syntax/regression fully unguarded |
| 5 | **Integration loop** | Delivery = files written + dependencies in place (node_modules symlinks) + service restarted + boot loading verified + functionality actually tested | "File correct" ≠ "system runs"; the missing steps are left undone |
| 6 | **Coexistence defense** | Scan for conflicts before starting (namespace / wiring.id / system-prompt slots / settings-page order / tool names), reuse an isomorphic already-shipped reference as a template | New plugins step on each other; shared-resource changes don't list the impact scope |

All six rules live in the static persona text of `agent.cordis.yml`, injecting no dynamic content—**the rules themselves do not break rule #1's cache hit**.

#### Comparison with other Agents

| Capability | Hexagon ProMax | Mainstream general-purpose Agent (Claude Code / Codex CLI / Cursor, etc.) |
|---|---|---|
| Cache hit rate | Static prefix preserves the cache, maximum hit rate | Runtime context varies with the session, fragile prefix, high uncached cost |
| Token cost | Cached input ≈ 1/30 the price; zero waste on light tasks | Dynamic injection per request, cache benefit greatly diminished |
| Platform awareness | Knows the HarmonyOS/dsh-specific constraints: no native ELF, `chmod 600` rejected, no hard-link support, isogit shim, native plugins crash on startup | Modeled on Linux/server assumptions; crashes or is restricted from the first step on HarmonyOS |
| Integration loop | **symlink → restart → boot verification → live test** hard-coded as a mechanical checklist | Stops at code written + tests passed; doesn't know the dsh-specific steps |
| Verification discipline | "Evidence after a change" written into the persona; verification commands and output recorded | Relies on model discretion, not enforced; prone to "should be fine" empty assertions |

**Why it crushes general-purpose Agents:** A general-purpose Agent's "done" standard is "code written + tests passed", but the "done" standard for dsh plugin delivery is "the system actually runs". The difference is exactly that whole stretch of **platform-specific finishing steps**—node_modules symlinks must be created inside the `~/.dsh` tree, restarts must use `--patch harmony.patch.yml`, boot entries must be verified as loaded, and functionality must be tested live. General-purpose Agents don't know these steps; they treat "written" as the finish line. ProMax writes this mechanical checklist into the persona, making the "finishing" an unskippable part of delivery.

**Where these rules came from:** They were not designed; they grew out of real plugin-development testing. Problems exposed while using ProMax to write the Arknights operator character plugin (dsh-arknights-persona)—zero syntax errors, all APIs correct (9/10), but the node_modules symlink wasn't created, no restart, no boot verification, no live test (integration loop only 6/10)—each became a rule in the table above. That's exactly what "strongest delivery" means: **code delivery 9/10, system running 6/10—the gap is in finishing discipline, not intelligence.**

### 2.5 Install the ops-mode dependency (only required by `harmony-chat-ops`)

The ops preset references a **custom plugin** outside dsh, `@deepseek-ai/dsh-tool-list` (directory enumeration; the dsh fs service has no readdir). It is not part of dsh's base installation and must be placed in two locations manually (source + profile-layer symlink, both required):

```bash
# ① Put the source into dsh's base node_modules (presets resolve by bare package name to this layer)
cp -r plugins/@deepseek-ai/dsh-tool-list ~/dsh-test/node_modules/@deepseek-ai/
# ② Symlink into the profile-layer dependency tree (web profile's node_modules resolves up to profiles/node_modules)
ln -s ~/dsh-test/node_modules/@deepseek-ai/dsh-tool-list ~/.dsh/profiles/node_modules/@deepseek-ai/
```

> The scheduled-task tools `schedule_create/list/delete` ship with dsh's base installation (`@deepseek-ai/dsh-schedule` is a direct dsh dependency), and `harmony.patch.yml` already mounts them via `insert`; no additional installation needed.

### 3. Start dsh (with the HarmonyOS patches)

```bash
sh scripts/dsh-web.sh
# Equivalent manual startup:
# cd ~/dsh-test && node --expose-internals node_modules/@deepseek-ai/dsh/lib/bin.js \
#   --profile web --patch <this repo>/harmony.patch.yml
```

After startup, open `http://127.0.0.1:3080` in a browser.

> **`--expose-internals` is required**, otherwise `cordis-plugin-hmr` errors out; `--patch harmony.patch.yml` is required, otherwise native plugins crash. `dsh-web.sh` automatically locates the patch file in the repository by default, or it can be overridden with `PATCH_YML`.

### 3.5 Headless mode (unattended / benchmarking)

The headless tree has more native-dependency plugin lines than web (bash/pwsh/fs-search, etc.), so a second patch is needed:

```bash
cd ~/dsh-test && node --expose-internals node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile headless --patch <this repo>/harmony-headless.patch.yml "task description"
```

> ⚠ `fs-sandbox` is the pure-JS provider of the fs service and **must not be disabled** (`tool-fs` depends on it). The headless patch only disables native-dependency plugin lines.

### 4. Apply the node_modules patches (re-apply after upgrade/reinstall)

```bash
node scripts/dsh-update.mjs patch
```

Re-applies the three patches idempotently using content anchors (recognizes code changes in new versions). Without these three patches:
- Can't configure a model API key (credential 660 permission check)
- Sending messages errors with `EPERM link` (session persistence)
- No permission-preset dropdown in the dialog (`dsh-permission-presets` must read `sandboxMode` from the fs sandbox)

---

## Performance Benchmarks: "Hexagon" scores of the five presets (2026-08-18)

Benchmark engine = **Hexagon capability radar** (6 axes × 2 questions each = 12 auto-graded questions across math/code/logic/facts/planning/self-correction, via the opencode-go API with free cost:0) + **performance table** (DeepSeek direct API, same prefix sent 4 times in a row, measuring the 4th send's steady-state cache hit rate; prefix cache billed in 128-token chunks) + **delivery quality table** (3 process questions scored by marking hits against delivery steps, measuring how thoroughly the persona's delivery discipline is followed).

### Hexagon capability radar

| Preset | Math | Code | Logic | Facts | Planning | Self-correction | Overall |
|---|---|---|---|---|---|---|---|
| `harmony-chat` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |
| `harmony-chat-pro` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |
| `harmony-chat-promax` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |
| `harmony-chat-ops` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |
| `harmony-chat-rampagemax` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |

The capability floor is identical and perfect—all five presets share the same model, so the benchmark is really comparing **performance and delivery discipline**, not capability.

### Performance table (before → after: after padding the persona with static instructions to cross the 128-token chunk boundary)

| Preset | Prefix tokens | Cache hit rate | Output efficiency (median tok/correct question) | Avg. time |
|---|---|---|---|---|
| `harmony-chat` | 273 | 52.9% → **93.8%** | 70 | 130s |
| `harmony-chat-pro` | 406 | 71.3% → **94.6%** | 73 | 98s |
| `harmony-chat-promax` | 794 | 87.2% → **96.7%** | 104 | **71s** |
| `harmony-chat-ops` | 523 | 97.9% → 97.9% | 155 | 99s |
| `harmony-chat-rampagemax` | 914 | 89.9% → **98.0%** | 125 | 142s |

### Delivery quality (delivery-spec adherence)

| Preset | Integration loop W1 | Verify before claiming done W2 | Retrospective & wrap-up W3 | Overall |
|---|---|---|---|---|
| `harmony-chat` | 75 | 75 | 67 | **72** |
| `harmony-chat-pro` | 25 | 50 | 67 | **47** |
| `harmony-chat-promax` | **100** | **100** | 67 | **89** |
| `harmony-chat-ops` | 25 | 50 | 33 | **36** |
| `harmony-chat-rampagemax` | **100** | 75 | **100** | **92** |

**Conclusions**

- **ProMax = the Hexagon all-rounder**: full marks across all six capability axes, performance maxed out—cache 96.7% in the top tier, output efficiency 104 tok (most economical among fully-featured presets), average time 71s the fastest of all, delivery-spec score 89 second only to Rampage Max. **Performance and delivery discipline in one.**
- **Rampage Max = the ceiling of delivery quality**: delivery-spec score **92, the highest of all**, integration loop 100 + retrospective & wrap-up 100 (the only full marks)—verification/retrospective/loop carried through most thoroughly; cache 98.0% also the highest, but efficiency 125 tok and time 142s the longest, as intended by the "no token savings, quality first" design.
- **Minimal harmony-chat is the most output-frugal**: efficiency 70 tok the lowest of all, but no delivery-discipline clauses, delivery 72; pro is the next most frugal at 73 tok, but delivery discipline is weak (47).
- **Cache optimization is immediately effective**: padding static persona instructions pushes the prefix across the 128-token chunk boundary (remainder ≤15), raising the hit rate from 52.9-89.9% to 93.8-98.0%—cached input is roughly **30×** cheaper than uncached, so prefix stability is the biggest lever.
- For runtime-context presets (harmony-chat / rampagemax), real-session prefixes vary with snapshots; this is the ideal static baseline, so actual hit rates are slightly lower.

Raw data `bench/result.json`, report `bench/result.md`; the benchmark script `bench/bench.mjs` is reproducible.

---

## Toolchain

| Script | Purpose |
|---|---|
| `scripts/dsh-web.sh` | Start/restart the dsh Web service (3080, idempotent liveness probe) |
| `scripts/dsh-update.mjs` | dsh update checks: `check` / `patch` / `install` / `rollback`; re-applies patches automatically after an upgrade |
| `scripts/dsh-manual-install.mjs` | Manual installer: recursively resolves the full dependency graph from registry metadata and installs tarballs directly (bypasses npm arborist resolution hang); `install()`/`rollback()` call it automatically, npm as fallback |
| `scripts/dsh-update-web.sh` | Settings and update page (3098, embedded HTML) |
| `scripts/dsh-hm-install.mjs` | One-click install of GitHub-source plugins (bypasses isogit interception) |

All scripts support overriding the node path via the `NODE_BIN` environment variable (HarmonyOS default `/data/service/hnp/node.org/node_v24.13.0/bin/node`).

---

## HarmonyOS adaptation details

### What the installer does (`dsh-hm-install.mjs`)

When you click a GitHub-source plugin in the market (intercepted via the `process.platform === 'openharmony'` branch):
1. `fetch` the source `tar.gz` and recursively scan for plugin directories carrying a dsh manifest
2. Install directly if precompiled artifacts exist; otherwise **attempt an in-place build** (`--ignore-scripts` as a fallback for native postinstall)
3. Strip the missing `dsh.client` frontend artifacts (prevents `MissingClientBundleError` from crashing startup), installing server-only
4. Symlink into the `~/.dsh/profiles/web` dependency tree, write the manifest, and take effect after a restart

> ⚠ **link plugins must live inside the `~/.dsh` tree**: put the source in `plugins-src/<name>` and write `link:/storage/Users/currentUser/.dsh/profiles/web/plugins-src/<name>` in `package.json`; otherwise the `@deepseek-ai/*` symlinks won't resolve.

### Which plugins can be installed

Only plugins depending on **pure JS / `node:sqlite`** are selected. Native dependencies (koffi/pty/esbuild/WASM runtimes) cannot run on HarmonyOS.

---

## Limitations

- No `systemd` / `cron` / `XDG autostart`; HarmonyOS has no autostart system service. For autostart, set the "Terminal" App to launch on boot in HarmonyOS settings plus a shell liveness hook to pull the service up
- `bash`/terminal execution and the sandbox are disabled; the Agent cannot actually run shell commands, and can only work through file editing / web search / Skills / planning / delegation
- Cannot switch back to the official `standard` / `code` / `minimal` presets (they depend on disabled native capabilities and will report `agent-preset-invalid`)
- Pure-UI client plugins become empty shells; WASM-runtime dependencies only crash when invoked

---

## License and acknowledgments

MIT License, see [LICENSE](LICENSE).

This project does not include dsh source code; it only contains independently written configuration, patch scripts, and documentation. dsh itself is released by [DeepSeek](https://github.com/deepseek-ai/dsh) under the MIT license; this repository's references to it and its patches follow the MIT terms, and we hereby acknowledge it.

---

## Changelog

### 2026-08-20 — Follow official 0.1.0-rc.8

dsh was officially updated to `0.1.0-rc.8` (released 2026-08-19); this repository's ported version is synced. Upgrade highlights:

- **`dsh-update.mjs getLatest()` dist-tags fix**: the official `dist-tags.latest` stayed at rc.7 after rc.8 shipped, so `npm view version` reported "already latest". It now scans the full `versions` list and picks the numerically highest (rc.N and stable compared by number); `check` verified `installed = latest = 0.1.0-rc.8`.
- **New `scripts/dsh-manual-install.mjs`**: npm's arborist silently hangs during dependency resolution on HarmonyOS (no output, low CPU, times out — reproduced 3×). The manual installer recursively resolves the full dependency graph from registry metadata and installs tarballs directly, keeping baseline packages that already satisfy their spec and gating optional dependencies by `os`/`cpu`. Verified a 470-package closure with zero gaps. Wired into `dsh-update.mjs` `install()`/`rollback()` with npm as fallback.
- **rc.8 dependency tree**: 54 `@deepseek-ai/dsh-*` packages bumped `^0.1.0-rc.7` → `^0.1.0-rc.8` (including official changes: pass reasoning_content back on every reasoned turn, SQLite persistence layout optimization, Agent Teams directory renames, build artifact slot binding, pwsh persistent pty) plus new `@deepseek-ai/dsh-tool-pwsh-persistent`.
- **All three HarmonyOS patches anchored cleanly on rc.8**: credentials (skip chmod-600 owner check), session (link→rename + `rename` import; the SQLite change did not touch the JSONL persistence file), permission (`ctx.shell.sandboxMode` → `ctx.fs.sandboxMode`).
- **Verified loop**: manual install of rc.8 → re-apply patches → restart dsh → 3080 HTTP 200 → plugins load (deveco-bridge 5 tools / evoresearch / dsh-cost-meter) → all seven HarmonyOS presets report `broken: none` in `agentPreset.list`.

### 2026-08-18 — Follow official 0.1.0-rc.7

dsh was officially updated to `0.1.0-rc.7` (released in the DeepSeek group chat); this repository's ported version is synced. Upgrade highlights:

- **`--ignore-scripts` bypasses the koffi native build**: the rc.7 dependency tree bumps koffi to 3.1.5, whose install script needs CMake to compile native binaries—HarmonyOS has no compiler, so it fails outright. Testing confirms koffi's native part is only lazy-loaded via dsh-fs-local on the win32 path (never triggered on HarmonyOS), node-pty is unavailable on this machine anyway, sharp ships precompiled, and all `@deepseek-ai` packages are pure JS with no install scripts—so skipping scripts entirely during install is safe. This is now baked into `scripts/dsh-update.mjs`, so future upgrades won't hit this pitfall again.
- **DeepSeek adds a `low` reasoning tier**: the official adapter now supports `off/low/high/max` (default remains `high`); `medium` is invalid. The measured note in `docs/CACHE-OPTIMIZATION.md` has been synced.
- **Upgrade loop**: npm install → re-apply the HarmonyOS patches (credentials/session) → restart dsh → 3080 works → all five presets' `agent.cordis.yml` pass the rc.7 `entryListSchema` validation and load successfully.

### 2026-08-18 — Benchmark rewritten as "Hexagon radar + performance table + delivery quality table"

The benchmark expanded from 6 questions to 6 axes × 2 questions = 12 auto-graded questions, and a delivery quality table was added (3 process questions scored by marking hits against delivery steps). Key numbers: all five presets get full marks across the six capability axes (same-model capability floor); cache hit rate after static persona padding goes from 52.9-89.9% to 93.8-98.0%; delivery-spec scores—promax 89 (performance and discipline in one), rampagemax 92 the highest of all (only full marks in retrospective & wrap-up, but most expensive in efficiency/time). The script `bench/bench.mjs` is reproducible, with raw data `result.json` and report `result.md`. README summary synced: preset count four→five (added the `harmony-chat-rampagemax` row to the mode table), and the summary benchmark figures updated to the post-padding 93.8-98.0%.

### 2026-08-18 — Added the Rampage Max preset (no token savings, quality first)

**The fifth conversation mode `harmony-chat-rampagemax`**, the opposite of promax—trades cache for quality; use with caution (high token consumption):

- **Runtime context enabled** (`includeRuntimeContext:true`), prefix varies dynamically with the session, low cache hit rate
- **Web fetch fully enabled** (`fetch:true`, search timeout relaxed to 30s), can fetch full page text for verification
- **Double verification + cross-checking on critical paths**; light tasks get no shortcuts, everything runs the full loop
- **Exhaustive pre-check scan**: namespace / wiring.id / system-prompt slots / settings-page order / tool names checked one by one
- **Full-Pro delegation**: subagents are always routed to deepseek-v4-pro, getting it right the first time
- **Built-in caution warning in the persona**: "May drain the entire account quota in one go; use only for hard debugging, cross-file refactoring, or the final check before delivery"

**Measured loop**: YAML parsing passes → synced the running copy → dsh restarted → `agentPreset.list` shows "HarmonyOS Rampage Max loaded, broken: none" → `agentPreset.read` returns the full 7409-character text including the caution warning / quality-first / double / exhaustive / delegation.

### 2026-08-18 — Hexagon ProMax: delivery discipline upgrade

**promax's persona block was rewritten into six hard rules** (task tiering / pre-check / implementation / integration loop / verify before claiming done / delegation), all static text, no dynamic content injected, cache hit rate unaffected. The core is writing "integration loop" and "verify before claiming done" as an unskippable mechanical checklist: delivery = files written + node_modules symlinks + restart + boot verification + live test.

**Trigger**: the measured test of using promax to write the Arknights operator character plugin (dsh-arknights-persona). Result—code delivery 9/10 (zero syntax errors, all APIs correct, idiomatic framework), but the integration loop was only 6/10 (symlink not created, no restart, no boot verification, no live test). Conclusion: **the gap is in finishing discipline, not intelligence**, so each shortfall became a rule in the persona. See "2.4 Hexagon ProMax" above.

### 2026-08-17 — Added the ops resident task steward mode + scheduled tasks

**New features**

- **The `harmony-chat-ops` resident background task steward preset**: an unattended task mode for HarmonyOS devices, pure JS with zero native dependencies. Three categories of duties—knowledge organization (read directory → extract → deduplicate → archive to `~/dsh-kb/`), batch file processing (rename/archive/deduplicate → manifest to `~/dsh-kb/logs/`), and scheduled reports (auto-generated to `~/dsh-kb/reports/` when due). Things outside these three categories are first confirmed with the user.
- **`@deepseek-ai/dsh-tool-list` directory enumeration plugin**: dsh's fs service has no readdir, so the ops mode cannot discover directory contents. This adds a zero-dependency `list_dir` tool (`node:fs/promises`) supporting relative paths, file sizes, and a 200-entry limit.
- **`harmony.patch.yml` mounts dsh-schedule for scheduled tasks**: registers `schedule_create / schedule_list / schedule_delete` for the web session's root agent (the package ships with dsh's base installation); one-shot/periodic reminders auto-trigger when due, and the agent executes and archives them when idle.
- **Delegated subagents route to Pro**: overrides `tool-subagent`'s `agentOptions` entirely by id to `deepseek-v4-pro` (measured: agentOptions inside presets don't take effect; the profile-layer override is required). The flash main loop saves cost; complex subtasks go to Pro to be done right the first time, avoiding repeated trial-and-error round trips.

**Measured loop (verified on this machine)**

- Manual batch: an ops session enumerated 3 meeting notes in `~/dsh-kb-test/notes/` → read → deduplicated "budget ok" → archived to `~/dsh-kb/会议纪要/*.md` (with a source table).
- Scheduled: `schedule_create after_seconds: 60` auto-triggers when due, and the agent independently produces `~/dsh-kb/reports/notes-summary-*.md`; after a one-shot reminder executes, it no longer appears in `schedule_list`.
- Regression: the existing harmony-chat / pro / promax presets all load without errors and web stays UP; test data has been cleaned up.

**Fixes**

- Fixed the bug where creating new sessions failed: custom plugin package names referenced by presets must exist in both dsh's base `node_modules` and the profile-layer `node_modules` symlink layer (the host composition base resolves upward to `profiles/node_modules`); a missing symlink causes preset mount failure → `SessionCreateError`. Install steps are in "2.5" above. `dsh-tool-list` has been put in place on this dual path.
