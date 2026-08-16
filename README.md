# dsh-harmonyos

让 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh）在 **HarmonyOS / 鸿蒙** 设备上完整跑起来的全套适配方案。

> 鸿蒙端几乎没人做这件事——原生 ELF/.node 模块、node-pty、Koffi 在这类设备上都加载不了。本仓库把「安装、打补丁、缓存优化、插件安装、自更新」一整套工程沉淀成可复刻的开源方案。

- **三套「鸿蒙对话模式」Agent 预设**：把 DeepSeek 前缀缓存命中率拉到最高，同时保留任务交付能力
- **启动补丁** `harmony.patch.yml`：禁用依赖原生二进制的插件行，让 dsh 不再启动即崩
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

## 快速开始

### 1. 安装 dsh

```bash
cd ~/dsh-test && npm install @deepseek-ai/dsh
```

> 安装位置可用 `DSH_DIR` 环境变量覆盖；下文默认 `~/dsh-test`。

### 2. 部署预设（对话模式）

把三个模式目录拷进 dsh 的用户预设目录：

```bash
mkdir -p ~/.dsh/.agent-presets
cp -r presets/* ~/.dsh/.agent-presets/
```

然后在 `~/.dsh/settings.yaml` 里把默认对话模式设为其中一个：

```yaml
agent-presets:
  default: harmony-chat-promax
```

三套模式在 dsh 设置面板「对话模式」下拉里可随时自由切换（切换只影响新建会话）。详见 [docs/CACHE-OPTIMIZATION.md](docs/CACHE-OPTIMIZATION.md) 了解它们为什么快。

| 模式 | persona | 缓存策略 | 工具集 |
|---|---|---|---|
| `harmony-chat`（基础） | 常规 | 开运行上下文（前缀易变） | 单 Agent |
| `harmony-chat-pro`（缓存极致） | `complete:true` 唯一提示段 | 前缀零变化，命中率极限 | 单 Agent，计划纪律内建 |
| `harmony-chat-promax`（交付最强） | `complete:false` | 关闭运行上下文，长稳定前缀 | + 子代理 / 工作流 / Ralph 委派组 |

### 3. 启动 dsh（带鸿蒙补丁）

```bash
sh scripts/dsh-web.sh
# 等价手启动：
# cd ~/dsh-test && node --expose-internals node_modules/@deepseek-ai/dsh/lib/bin.js \
#   --profile web --patch <本仓库>/harmony.patch.yml
```

启动后浏览器访问 `http://127.0.0.1:3080`。

> **必须 `--expose-internals`**，否则 `cordis-plugin-hmr` 报错；必须带 `--patch harmony.patch.yml`，否则原生插件崩溃。`dsh-web.sh` 默认自动定位仓库内的补丁文件，也可用 `PATCH_YML` 覆盖。

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
