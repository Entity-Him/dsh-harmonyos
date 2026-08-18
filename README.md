# dsh-harmonyos

让 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh）在 **HarmonyOS / 鸿蒙** 设备上完整跑起来的全套适配方案。

> 鸿蒙端几乎没人做这件事——原生 ELF/.node 模块、node-pty、Koffi 在这类设备上都加载不了。本仓库把「安装、打补丁、缓存优化、插件安装、自更新」一整套工程沉淀成可复刻的开源方案。

> **项目交流 QQ 群：930088487** —— 鸿蒙 dsh 适配、缓存优化、插件开发，欢迎加入交流

- **五套「鸿蒙对话模式」Agent 预设**：把 DeepSeek 前缀缓存命中率拉到最高，同时保留任务交付能力——`harmony-chat`（极简）/ `harmony-chat-pro`（缓存极致）/ `harmony-chat-promax`（六边形交付最强）/ `harmony-chat-ops`（常驻后台任务管家）/ `harmony-chat-rampagemax`（狂暴质量）
- **六边形 ProMax**（2026-08-18 升级）：缓存命中 / 省 token / 交付能力 / 测试验证 / 集成闭环 / 共存防御六条硬规则同场，把「写完代码」与「系统跑起来」之间的鸿沟写成机械清单，交付纪律对标并反超主流通用 Agent
- **狂暴 Max**（2026-08-18 新增）：不省 token 只讲质量与交付的极限模式——运行上下文 + 网页抓取全开，预检穷尽扫描，集成闭环与双重验证写死为铁律。慎用：高 token 消耗，可能清空账户额度
- **启动补丁** `harmony.patch.yml`（web）+ `harmony-headless.patch.yml`（headless）：禁用依赖原生二进制的插件行，让 dsh 不再启动即崩
- **省 token 优化实测**：11 道基准 A/B 验证 `reasoningEffort: high` 为帕累托最优（全对 + 步数最少 + 成本几乎不变），promax 委派组挂 Pro 模型路由兜底复杂子任务
- **五套预设跑分（2026-08-18）**：经静态 persona 填充（前缀越过 128-token 块边界），静态前缀预设缓存命中率 52.9%–89.9% → **93.8%–98.0%**（promax 96.7%、ops 97.9%、rampagemax 98.0%），连开运行上下文的 harmony-chat 也拉到 93.8%——用数据印证「保缓存先保前缀稳定」（详见下方「性能实测」）
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

本仓库的全部内容都是纯文本 / 纯 JS 的配置与脚本，**不删除、不加密、不外传你的数据，不注册系统服务、不要求 root 权限**，可放心使用：

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

把五个模式目录拷进 dsh 的用户预设目录：

```bash
mkdir -p ~/.dsh/.agent-presets
cp -r presets/* ~/.dsh/.agent-presets/
```

然后在 `~/.dsh/settings.yaml` 里把默认对话模式设为其中一个：

```yaml
agent-presets:
  default: harmony-chat-promax
```

五套模式在 dsh 设置面板「对话模式」下拉里可随时自由切换（切换只影响新建会话）。详见 [docs/CACHE-OPTIMIZATION.md](docs/CACHE-OPTIMIZATION.md) 了解它们为什么快。

| 模式 | persona | 缓存策略 | 工具集 |
|---|---|---|---|
| `harmony-chat`（基础） | 常规 | 开运行上下文（前缀易变） | 单 Agent |
| `harmony-chat-pro`（缓存极致） | `complete:true` 唯一提示段 | 前缀零变化，命中率极限 | 单 Agent，计划纪律内建 |
| `harmony-chat-promax`（六边形交付最强） | `complete:false` | 关闭运行上下文，长稳定前缀 | + 子代理 / 工作流 / Ralph 委派组 + 六条交付硬规则 |
| `harmony-chat-ops`（任务管家） | 常驻后台任务管家 | 关闭运行上下文，前缀稳定 | + 定时调度（schedule_create/list/delete）+ 目录枚举（list_dir） |
| `harmony-chat-rampagemax`（狂暴 Max） | 不省 token 只讲质量与交付 | 开运行上下文（前缀易变）+ 网页抓取全开 | + 委派组（全 Pro）+ 预检穷尽 / 双重验证 / 复盘铁律 |
| `harmony-chat-rampagemax`（狂暴Max，慎用） | 不省 token 只讲质量与交付 | **打开**运行上下文，前缀动态、命中率低 | 全部 promax 能力 + 网页 fetch 全开 + 双重验证/交叉互证 + 委派全量 Pro + 预检穷尽扫描 |

### 2.4 六边形 ProMax：鸿蒙上交付能力的天花板

`harmony-chat-promax` 不在「缓存命中」与「交付能力」之间做取舍，而是六条硬规则同场——每一条都对应一次真实踩坑后的沉淀：

| # | 维度 | 规则 | 对抗的失败模式 |
|---|---|---|---|
| 1 | **缓存命中** | `includeRuntimeContext:false`，系统提示全静态、前缀零变化 | 前缀随会话动态变，DeepSeek 缓存命中率掉到谷底（未命中输入贵约 **30 倍**） |
| 2 | **省 token** | 静态前缀 + 任务分级：轻任务直接完成不写计划，重任务才走完整闭环 | 把「简单问答」也铺成计划/多轮往返，输出白烧 |
| 3 | **交付能力** | 完整提示段全保留（计划策略 / 工具指引 / 委派组），只关运行上下文 | 为保缓存砍成瘦壳，重任务交付不了 |
| 4 | **测试验证** | 「声称完成前必须跑验证命令拿到真实输出，拿不出证据等于未完成」 | 写完代码就宣称完成，语法/回归全裸奔 |
| 5 | **集成闭环** | 交付 = 文件写完 + 依赖就位（node_modules 软链）+ 重启服务 + 核对 boot 加载 + 实测生效 | 「文件正确」≠「系统能跑起来」，差的那几步没人做 |
| 6 | **共存防御** | 动手前先扫冲突（namespace / wiring.id / system-prompt 槽位 / 设置页 order / 工具名），复用同构已上线参照作模板 | 新插件互相踩，改共享资源不列影响面 |

六条全部落在 `agent.cordis.yml` 的 persona 静态文本里，不注入任何动态内容——**规则本身不破坏第 1 条缓存命中**。

#### 与其他 Agent 的对比

| 能力 | 六边形 ProMax | 主流通用 Agent（Claude Code / Codex CLI / Cursor 等） |
|---|---|---|
| 缓存命中率 | 静态前缀保缓存，命中率极限 | 运行上下文随会话动态变化，前缀易碎，未命中价高 |
| token 成本 | 命中输入 ≈ 1/30 价，轻任务零铺张 | 每次请求动态注入，缓存收益大打折扣 |
| 平台感知 | 知道鸿蒙/dsh 特有条件：无原生 ELF、`chmod 600` 被拒、不支持硬链接、isogit 垫片、原生插件启动即崩 | 按 Linux/服务器假设建模，在鸿蒙上第一步就崩或受限 |
| 集成闭环 | **软链 → 重启 → boot 核对 → 实测**写死成机械清单 | 写完代码 + 测试过就停，不知道 dsh 特有步骤 |
| 验证纪律 | 「改完有证据」写入 persona，验证命令与输出记录在案 | 靠模型自觉，无强制，易「应该好了」式空口断言 |

**为什么能秒杀通用 Agent：** 通用 Agent 的「完成」标准是「代码写完 + 测试过」，而 dsh 插件交付的完成标准是「系统能跑起来」。差的正是那一整段**平台特有收尾**——node_modules 软链要建在 `~/.dsh` 树内、重启要带 `--patch harmony.patch.yml`、boot entries 要核对加载、功能要实测。通用 Agent 不知道这些步骤，它把「写完」当终点；ProMax 把这套机械清单写进 persona，把「收尾」也当成不可跳过的交付环节。

**这套规则从哪里来：** 不是设计出来的，是从插件开发实测里逐条长出来的。用 ProMax 写明日方舟干员角色插件（dsh-arknights-persona）时暴露的问题——代码零语法错误、API 全对（9/10），但 node_modules 软链没建、没重启、没核对 boot、没实测（闭环仅 6/10）——每条都变成上面的一格规则。这正是「交付最强」的含义：**代码交付率 9/10，系统跑通率 6/10，差在收尾纪律不在智能。**

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

## 性能实测：五套预设「六边形」跑分（2026-08-18）

跑分引擎 = **六边形能力雷达**（数学/代码/逻辑/事实/规划/自我修正 6 轴 × 2 题 = 12 道全自动判分，走 opencode-go API 免费 cost:0）+ **性能表**（DeepSeek 直连 API 同前缀连发 4 次测第 4 次稳态缓存命中率，前缀缓存按 128-token 块计费）+ **交付质量表**（3 道流程题按交付步骤标记命中打分，测 persona 交付纪律贯彻度）。

### 六边形能力雷达

| 预设 | 数学 | 代码 | 逻辑 | 事实 | 规划 | 自我修正 | 综合 |
|---|---|---|---|---|---|---|---|
| `harmony-chat` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |
| `harmony-chat-pro` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |
| `harmony-chat-promax` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |
| `harmony-chat-ops` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |
| `harmony-chat-rampagemax` | 100 | 100 | 100 | 100 | 100 | 100 | **100** |

能力地板一致且满分——五套共享同一模型，跑分比拼的是**性能与交付纪律**，不是能力。

### 性能表（before → after：给 persona 填充静态指令越过 128-token 块边界后）

| 预设 | 前缀 token | 缓存命中率 | 输出效率（中位 tok/正确题） | 平均耗时 |
|---|---|---|---|---|
| `harmony-chat` | 273 | 52.9% → **93.8%** | 70 | 130s |
| `harmony-chat-pro` | 406 | 71.3% → **94.6%** | 73 | 98s |
| `harmony-chat-promax` | 794 | 87.2% → **96.7%** | 104 | **71s** |
| `harmony-chat-ops` | 523 | 97.9% → 97.9% | 155 | 99s |
| `harmony-chat-rampagemax` | 914 | 89.9% → **98.0%** | 125 | 142s |

### 交付质量（交付规范贯彻度）

| 预设 | 集成闭环 W1 | 验证先于完成 W2 | 复盘收尾 W3 | 综合 |
|---|---|---|---|---|
| `harmony-chat` | 75 | 75 | 67 | **72** |
| `harmony-chat-pro` | 25 | 50 | 67 | **47** |
| `harmony-chat-promax` | **100** | **100** | 67 | **89** |
| `harmony-chat-ops` | 25 | 50 | 33 | **36** |
| `harmony-chat-rampagemax` | **100** | 75 | **100** | **92** |

**结论**

- **ProMax = 六边形战士**：能力六轴全满分，性能拉满——缓存 96.7% 进第一梯队、输出效率 104 tok（全功能预设最省）、平均耗时 71s 全场最快，交付规范 89 仅次于狂暴。**性能与交付纪律兼得**。
- **狂暴 Max = 交付质量天花板**：交付规范 **92 全场最高**，集成闭环 100 + 复盘收尾 100（唯一满分）——验证/复盘/闭环贯彻最彻底；缓存 98.0% 全场最高，但效率 125 tok、耗时 142s 最长，「不省 token 只讲质量」的设计本意。
- **极简 harmony-chat 最省输出**：效率 70 tok 全场最低，但无交付纪律条款，交付 72；pro 效率 73 次省，交付纪律弱（47）。
- **缓存优化立竿见影**：填充静态 persona 指令使前缀越过 128-token 块边界（余数 ≤15），命中率从 52.9-89.9% 拉到 93.8-98.0%——缓存命中输入比未命中便宜约 **30 倍**，前缀稳定性是最大杠杆。
- 运行上下文预设（harmony-chat / rampagemax）真实会话前缀随快照变化，此处为理想静态基线，实际命中率略低。

原始数据 `bench/result.json`、报告 `bench/result.md`，跑分脚本 `bench/bench.mjs` 可复现。

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

### 2026-08-18 — 跟进官方 0.1.0-rc.7

dsh 官方更新至 `0.1.0-rc.7`（DeepSeek 群聊发布），本仓库移植版已同步。升级要点：

- **`--ignore-scripts` 绕过 koffi 原生构建**：rc.7 依赖树把 koffi 升到 3.1.5，其 install 脚本需 CMake 编译原生二进制——鸿蒙无编译器直接失败。实测 koffi 原生部分只在 win32 路径被 dsh-fs-local 懒加载（鸿蒙永不触发）、node-pty 本机本就不可用、sharp 走预编译、@deepseek-ai 各包均为纯 JS 无 install 脚本，故安装时整体跳过 scripts 安全。已固化进 `scripts/dsh-update.mjs`，后续升级不再踩坑。
- **DeepSeek 推理档位新增 `low`**：官方适配器现支持 `off/low/high/max`（默认仍 `high`），`medium` 无效。已同步 `docs/CACHE-OPTIMIZATION.md` 实测注记。
- **升级闭环**：npm install → 重打鸿蒙补丁（credentials/session）→ 重启 dsh → 3080 正常 → 五套预设 `agent.cordis.yml` 经 rc.7 `entryListSchema` 校验全部可加载。

### 2026-08-18 — 跑分重写为「六边形雷达 + 性能表 + 交付质量表」

跑分从 6 题扩到 6 轴 × 2 题 = 12 道全自动判分，并新增交付质量表（3 道流程题按交付步骤标记命中打分）。核心数字：能力六轴五套全满分（同模型能力地板一致）；缓存命中率经静态 persona 填充后 52.9-89.9% → 93.8-98.0%；交付规范 promax 89（性能与纪律兼得）、rampagemax 92 全场最高（复盘收尾唯一满分，但效率/耗时最贵）。脚本 `bench/bench.mjs` 可复现，原始数据 `result.json`、报告 `result.md`。同步 README 简介：预设计数四套→五套（模式表补 `harmony-chat-rampagemax` 行），简介跑分数字更新为填充后 93.8-98.0%。

### 2026-08-18 — 新增狂暴 Max 预设（不省 token 只讲质量）

**第五套对话模式 `harmony-chat-rampagemax`**，与 promax 相反——牺牲缓存换质量，慎用（高 token 消耗）：

- **运行上下文打开**（`includeRuntimeContext:true`），前缀随会话动态变化，缓存命中率低
- **网页 fetch 全开**（`fetch:true`，搜索超时放宽 30s），可抓取页面全文核验
- **双重验证 + 关键路径交叉互证**，轻任务无捷径、全部走完整闭环
- **预检穷尽扫描**：namespace / wiring.id / system-prompt 槽位 / 设置页 order / 工具名逐一核对
- **委派全量 Pro**：子代理一律路由 deepseek-v4-pro，一次做对
- **persona 内置慎用警告**：「可能一次清空账户额度，仅攻坚疑难/跨文件重构/交付前终极检验时使用」

**实测闭环**：YAML 解析通过 → 同步运行副本 → dsh 重启 → `agentPreset.list` 显示「鸿蒙狂暴Max 已加载，broken: 无」→ `agentPreset.read` 7409 字符全段含慎用警告/质量第一/双重/穷尽/委派。

### 2026-08-18 — 六边形 ProMax：交付纪律升级

**promax 的 persona 块重写为六条硬规则**（任务分级 / 预检 / 实现 / 集成闭环 / 验证先于完成 / 委派），全部静态文本、不注入动态内容，缓存命中率不受影响。核心是把「集成闭环」与「验证先于完成」写成不可跳过的机械清单：交付 = 文件写完 + node_modules 软链 + 重启 + boot 核对 + 实测生效。

**触发背景**：用 promax 写明日方舟干员角色插件（dsh-arknights-persona）的实测。结果——代码交付 9/10（零语法错误、API 全对、框架地道），但集成闭环仅 6/10（软链未建、未重启、未核对 boot、未实测）。结论：**差在收尾纪律不在智能**，于是把每条缺口变成 persona 里的规则。详见上方「2.4 六边形 ProMax」。

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
