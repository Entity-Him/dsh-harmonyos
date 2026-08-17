# dsh-harmonyos

让 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh）在 **HarmonyOS / 鸿蒙** 设备上完整跑起来的全套适配方案。

> 鸿蒙端几乎没人做这件事——原生 ELF/.node 模块、node-pty、Koffi 在这类设备上都加载不了。本仓库把「安装、打补丁、缓存优化、插件安装、自更新」一整套工程沉淀成可复刻的开源方案。

- **四套「鸿蒙对话模式」Agent 预设**：把 DeepSeek 前缀缓存命中率拉到最高，同时保留任务交付能力；其中 `harmony-chat-ops` 为常驻后台任务管家模式
- **启动补丁** `harmony.patch.yml`（web）+ `harmony-headless.patch.yml`（headless）：禁用依赖原生二进制的插件行，让 dsh 不再启动即崩
- **省 token 优化实测**：11 道基准 A/B 验证 `reasoningEffort: high` 为帕累托最优（全对 + 步数最少 + 成本几乎不变），promax 委派组挂 Pro 模型路由兜底复杂子任务
- **node_modules 补丁脚本**：绕开鸿蒙文件系统的两个致命限制（`chmod 600` 被拒、不支持硬链接）
- **工具链**：GitHub 插件一键安装器、dsh 自更新器 + 设置页

---

## 为什么需要这套方案

| 鸿蒙设备的限制 | 后果 | 本仓库的解法 |
|---|---|---|
| 无法加载原生 ELF / `.node` 模块 | `node-pty`(subprocess)、`Koffi`(sandbox/fs-local) 启动即崩 | `harmony.patch.yml` 禁用这些插件行 |
| 文件系统强制组权限位，`chmod 600` 被拒 | 凭据文件权限检查永远炸，配不了 API key | 补丁 `dsh-credentials-local`：`assertOwnerOnly` 直接 `return` |
| 文件系统不支持硬链接 | session 持久化 `link()` 发布日志报 `EPERM` | 补丁 `dsh-session-persistence-jsonl`：`link` 改 `rename` |
| `git ls-remote` 被 isogit 垫片拦截 | GitHub 源插件装不了 | `scripts/dsh-hm-install.mjs` 安装器（fetch 源码 → 构建 → 软链） |

---

## 安全声明

本仓库的全部内容**不会对你的计算机造成任何影响**，可放心使用：

- **纯 JS / 纯文本**：预设是 YAML 配置文件，补丁是 YAML 覆盖层，插件是零依赖的纯 JS（只用 `node:fs/promises`），脚本是 Node/Shell 文本。不含可执行二进制、原生 `.node`/ELF 模块、内核改动或驱动。
- **不碰系统级东西**：不注册 `systemd` / 开机自启 / 系统计划任务，不改系统路径，不要求 root。所有写入都发生在 dsh 安装目录与 `~/.dsh` 用户配置目录内。
- **不动你的数据**：预设只改 dsh 的「对话模式」配置；插件只做目录列举与文件读取；补丁只开关 dsh 自己的插件行。不会删除、覆盖、加密或外传你的文件。
- **网络行为最小**：只在启动 dsh 时加载配置、在你主动发起对话/检查更新时访问 DeepSeek 与 GitHub 官方接口。无遥测、无埋点、无数据上报。
- **完全可审阅**：全仓库仅 20 余个文本文件，任何一行都可打开检查。
- **可逆卸载**：删除 `~/.dsh/.agent-presets/harmony-chat-ops/`、`~/dsh-test/node_modules/@deepseek-ai/dsh-tool-list/` 及 profile 层对应软链，重启 dsh 即完全还原。

---

## 快速开始

### 1. 安装 dsh

```bash
cd ~/dsh-test && npm install @deepseek-ai/dsh
```

> 安装位置可用 `DSH_DIR` 环境变量覆盖；下文默认 `~/dsh-test`。

### 2. 部署预设（对话模式）

把四个模式目录拷进 dsh 的用户预设目录：

```bash
mkdir -p ~/.dsh/.agent-presets
cp -r presets/* ~/.dsh/.agent-presets/
```

然后在 `~/.dsh/settings.yaml` 里把默认对话模式设为其中一个：

```yaml
agent-presets:
  default: harmony-chat-promax
```

四套模式在 dsh 设置面板「对话模式」下拉里可随时自由切换（切换只影响新建会话）。详见 [docs/CACHE-OPTIMIZATION.md](docs/CACHE-OPTIMIZATION.md) 了解它们为什么快。

| 模式 | persona | 缓存策略 | 工具集 |
|---|---|---|---|
| `harmony-chat`（基础） | 常规 | 开运行上下文（前缀易变） | 单 Agent |
| `harmony-chat-pro`（缓存极致） | `complete:true` 唯一提示段 | 前缀零变化，命中率极限 | 单 Agent，计划纪律内建 |
| `harmony-chat-promax`（交付最强） | `complete:false` | 关闭运行上下文，长稳定前缀 | + 子代理 / 工作流 / Ralph 委派组 |
| `harmony-chat-ops`（任务管家） | 常驻后台任务管家 | 关闭运行上下文，前缀稳定 | + 定时调度（schedule_create/list/delete）+ 目录枚举（list_dir） |

### 2.5 安装 ops 模式依赖（仅 `harmony-chat-ops` 需要）

ops 预设引用了一个 dsh 之外的**自定义插件** `@deepseek-ai/dsh-tool-list`（目录枚举，dsh fs 服务没有 readdir）。它不在 dsh 基础安装里，需手动放两份（源码 + profile 层软链，缺一不可）：

```bash
# ① 源码进 dsh 基础 node_modules（预设按裸包名解析到此层）
cp -r plugins/@deepseek-ai/dsh-tool-list ~/dsh-test/node_modules/@deepseek-ai/
# ② 软链进 profile 层依赖树（web profile 的 node_modules 向上走到 profiles/node_modules）
ln -s ~/dsh-test/node_modules/@deepseek-ai/dsh-tool-list ~/.dsh/profiles/node_modules/@deepseek-ai/
```

> 定时调度工具 `schedule_create/list/delete` 随 dsh 基础安装自带（`@deepseek-ai/dsh-schedule` 是 dsh 直接依赖），`harmony.patch.yml` 已用 `insert` 挂载，无需额外安装。

### 3. 启动 dsh（带鸿蒙补丁）

```bash
sh scripts/dsh-web.sh
# 等价手启动：
# cd ~/dsh-test && node --expose-internals node_modules/@deepseek-ai/dsh/lib/bin.js \
#   --profile web --patch <本仓库>/harmony.patch.yml
```

启动后浏览器访问 `http://127.0.0.1:3080`。

> **必须 `--expose-internals`**，否则 `cordis-plugin-hmr` 报错；必须带 `--patch harmony.patch.yml`，否则原生插件崩溃。`dsh-web.sh` 默认自动定位仓库内的补丁文件，也可用 `PATCH_YML` 覆盖。

### 3.5 headless 模式（无人值守/基准测试）

headless 树比 web 多出 bash/pwsh/fs-search 等原生依赖插件行，需要第二个补丁：

```bash
cd ~/dsh-test && node --expose-internals node_modules/@deepseek-ai/dsh/lib/bin.js \
  --profile headless --patch <本仓库>/harmony-headless.patch.yml "任务描述"
```

> ⚠ `fs-sandbox` 是纯 JS 的 fs 服务提供方，**不能禁**（`tool-fs` 靠它）。headless 补丁只禁原生依赖插件行。

### 4. 打 node_modules 补丁（升级/重装后需重打）

```bash
node scripts/dsh-update.mjs patch
```

按内容锚点幂等重打两个补丁（新版本改代码也能识别），不打这两处：
- 配不了模型 API key（凭据 660 权限检查）
- 发消息 `EPERM link`（session 持久化）

---

## 工具链

| 脚本 | 作用 |
|---|---|
| `scripts/dsh-web.sh` | dsh Web 服务启动/重启（3080，幂等探活） |
| `scripts/dsh-update.mjs` | dsh 检查更新：`check` / `patch` / `install` / `rollback`，升级后自动重打补丁 |
| `scripts/dsh-update-web.sh` | 设置与更新页（3098，内嵌 HTML） |
| `scripts/dsh-hm-install.mjs` | GitHub 源插件一键安装（绕过 isogit 拦截） |

所有脚本支持 `NODE_BIN` 环境变量覆盖 node 路径（鸿蒙默认 `/data/service/hnp/node.org/node_v24.13.0/bin/node`）。

---

## 鸿蒙适配细节

### 安装器做了什么（`dsh-hm-install.mjs`）

market 里点 GitHub 源插件时（`process.platform === 'openharmony'` 分支拦截）：
1. `fetch` 源码 `tar.gz`，递归扫描带 dsh 清单的插件目录
2. 有预编译产物直接装；没有则**就地尝试构建**（`--ignore-scripts` 兜底原生 postinstall）
3. 剥掉缺失的 `dsh.client` 前端产物（防 `MissingClientBundleError` 炸启动），装成仅服务端
4. 软链进 `~/.dsh/profiles/web` 依赖树，写 manifest，重启生效

> ⚠ **link 插件必须在 `~/.dsh` 树内**：`plugins-src/<name>` 放源码，`package.json` 写 `link:/storage/Users/currentUser/.dsh/profiles/web/plugins-src/<name>`，否则解析不到 `@deepseek-ai/*` 软链。

### 能装的插件范围

只选 **纯 JS / `node:sqlite`** 依赖的插件。原生依赖（koffi/pty/esbuild/WASM 运行时）在鸿蒙跑不了。

---

## 限制

- 无 `systemd` / `cron` / `XDG autostart`，鸿蒙没有开机自启系统服务。自启需在鸿蒙设置里把「终端」App 设为开机自启 + shell 探活钩子拉服务
- `bash`/终端执行与沙箱已禁用，Agent 无法真正跑 shell 命令，只能通过文件编辑 / 网页检索 / Skills / 计划 / 委派工作
- 无法切回 `standard` / `code` / `minimal` 官方 preset（它们依赖被禁用的原生能力，会报 `agent-preset-invalid`）
- 纯 UI 的 client 插件会变成空壳；WASM 运行时依赖只在调用时崩

---

## 许可证与致谢

MIT License，见 [LICENSE](LICENSE)。

本项目不包含 dsh 源码，只含独立编写的配置、补丁脚本与文档。dsh 本身由 [DeepSeek](https://github.com/deepseek-ai/dsh) 以 MIT 许可发布，本仓库对其的引用与补丁使用遵循 MIT 条款，特此致谢。

---

## 更新记录

### 2026-08-17 — 新增 ops 常驻任务管家模式 + 定时调度

**新增功能**

- **`harmony-chat-ops` 常驻后台任务管家预设**：鸿蒙设备上的无人值守任务模式，纯 JS、零原生依赖。三类职责——知识整理（读目录 → 提取 → 去重 → 归档 `~/dsh-kb/`）、批量文件处理（重命名/归档/去重 → 清单到 `~/dsh-kb/logs/`）、定时报告（到点自动生成 `~/dsh-kb/reports/`）。超出三类的事先询问用户。
- **`@deepseek-ai/dsh-tool-list` 目录枚举插件**：dsh 的 fs 服务没有 readdir，导致 ops 模式无法发现目录内容。补一个零依赖 `list_dir` 工具（`node:fs/promises`），支持相对路径、文件大小、200 条上限。
- **`harmony.patch.yml` 挂载 dsh-schedule 定时调度**：为 web 会话根 agent 注册 `schedule_create / schedule_list / schedule_delete`（包随 dsh 基础安装自带），一次性/周期提醒到点自动触发，agent 空闲时自动执行并归档。
- **委派子代理路由到 Pro**：按 id 整行覆盖 `tool-subagent` 的 `agentOptions` 为 `deepseek-v4-pro`（实测 preset 内的 agentOptions 不生效，需 profile 层覆盖）。主循环 flash 省成本，复杂子任务 Pro 一次做对，省去反复试错往返。

**实测闭环（本机验证）**

- 手动批量：ops 会话枚举 `~/dsh-kb-test/notes/` 3 篇会议纪要 → 读取 → 去重「预算 ok」 → 归档 `~/dsh-kb/会议纪要/*.md`（含来源表）。
- 定时：`schedule_create after_seconds: 60` 到点自动触发，agent 独立产出 `~/dsh-kb/reports/notes-summary-*.md`；一次性提醒执行后 `schedule_list` 不再出现。
- 回归：现有 harmony-chat / pro / promax 三套预设加载无错误，web 稳定 UP；测试数据已清理。

**修复**

- 修复了新建会话失败的 bug：预设引用的自定义插件包名需同时存在于 dsh 基础 `node_modules` 与 profile 层 `node_modules` 软链层（host 组合基座向上解析到 `profiles/node_modules`），缺软链会导致 preset mount 失败 → `SessionCreateError`。安装步骤见上文「2.5」。`dsh-tool-list` 已按此双路径就位。
