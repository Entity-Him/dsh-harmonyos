# 为什么这三套预设缓存命中率高

DeepSeek 的缓存是**前缀命中**：每次请求的前 N 个 token 与上次完全一致的部分直接走缓存（约 1/10 价格、低延迟）。所以优化的唯一目标就是——**让请求前缀在会话生命周期内一字不变，同时尽量长**。

## 实测数据

| 前缀情况 | 结果 |
|---|---|
| 短前缀（115 token），每次变化 | 0 命中 |
| 长固定前缀（2701 token），第二请求起不变 | 命中 2688/2701 ≈ **99.5%** |

结论：**命中率由「前缀稳定性」决定，不是前缀长度**。动态注入的内容（日期、最近文件快照、运行时状态）一出现，缓存就从第一个变化 token 处整体失效。

## 前缀里有哪些内容

dsh 每次请求的系统提示由这些部分组成（按固定顺序 band 拼接）：

```
-100   harness 身份（"You are an AI agent powered by DeepSeek Harness."）
  0    persona（deployment:persona 段）
 50    plan:policy（计划模式激活时的指令段）
100-199  各工具指引段（静态散文）
---   工具 schema（独立 wire 字段，不走 prompt 段）---
```

工具 schema 是独立 wire 字段，**添加工具不会破坏前缀**；真正破坏缓存的是动态的运行上下文快照。

## 关键开关

### `includeRuntimeContext: false`（决定性的那个）

关闭后，每个请求不再注入动态运行时上下文快照（sandbox/审批/委派等策略快照），前缀才真正稳定下来。**这是缓存优化的核心开关**。

### `complete: true`（pro 用）

让 persona 成为**唯一**系统提示段，assembly 结束后其余所有提示段文本（harness 身份、plan:policy、工具指引）全部被抑制。

| | `complete:false` | `complete:true` |
|---|---|---|
| 提示段 | 全部保留 | 只剩 persona |
| 前缀 | 长且稳定 | 短且稳定 |
| 命中率 | ≈99.5% | ≈99.5% |
| 每轮缓存掉的 token | **多**（提示长） | 少（提示短） |
| 计划策略/工具指引 | 保留 | 被抑制，需写进 persona |
| 工具 schema / agent-instructions | 不受影响 | 不受影响 |

`complete:true` 不会抑制工具 schema（独立 wire 字段），也不会抑制 `agent-instructions`（它以 user 角色历史消息注入，不是系统提示段）。它只抑制**提示段文本**。

### 一个小坑

`dsh-plan-mode` 的 `section` 配置**必填非空字符串**，缺了会在 mount 时报 `PlanModeConfig needs a string section`——即使 `complete:true` 下该段会被抑制，配置校验仍然要求它存在。

## 三套预设的取舍

### 基础 `harmony-chat`
对比标准 preset 只去掉了原生依赖的工具，其余照旧——**运行上下文开着**，前缀会随快照变化，缓存命中率不理想。是基线。

### 鸿蒙对话模式Pro `harmony-chat-pro`（缓存极致）
- `complete: true` + `includeRuntimeContext: false`
- 系统提示压缩成**唯一一段 persona**，会话生命周期内零变化 → 命中率天花板
- 每轮请求体最小、首 token 延迟最低
- 代价：plan:policy 与工具指引段被抑制，所以**计划纪律、交付准则直接写进 persona 文本**（见 `presets/harmony-chat-pro/agent.cordis.yml`），进入计划模式时模型仍会收到 user 角色的"已切换计划模式"通知
- 适合：日常任务、快速改文件、追求最省

### 鸿蒙对话模式ProMax `harmony-chat-promax`（交付最强）
- `complete: false` + `includeRuntimeContext: false`
- 保留完整提示段（harness 身份 + persona + plan:policy + 工具指引）→ **长稳定前缀**，每轮缓存掉的 token 更多，长期更省钱
- 在此基础上加了**委派组**（全部纯 JS、鸿蒙可跑）：`subagent` / `subagent_fork` 进程内并行子代理、`workflow` 工作流、`ralph` 最多 64 轮自主迭代
- 适合：复杂任务、多文件改造、需要并行交付

## 一句话总结

> `includeRuntimeContext: false` 保证前缀**稳定**（命中率拉到极限），
> `complete: true` 让前缀**最短**（pro），
> 保留完整提示段让前缀**最长**（promax 每轮缓存收益最大），
> 三者的工具 schema 都保持稳定，进一步保护缓存。
