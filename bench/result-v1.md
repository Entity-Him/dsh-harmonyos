# 鸿蒙五套对话预设跑分报告

> 跑分引擎: 基准题走 opencode-go API（模型 deepseek-v4-flash，免费 cost:0）；缓存命中走 DeepSeek 直连 API（同模型，准确）。日期 2026-08-18。基准题 6 道，每套预设同前缀连发 4 次（前 3 次加温）测第 4 次稳态缓存命中。

## 总览

| 预设 | persona 字符 | 系统提示 token | 缓存命中率 | 正确率 | 说明 |
|---|---|---|---|---|---|
| harmony-chat | 253 | 242 | 52.9% | 6/6 | 基础：运行上下文开，前缀易变 |
| harmony-chat-pro | 462 | 359 | 71.3% | 6/6 | 缓存极致：complete + 静态前缀最短 |
| harmony-chat-promax | 923 | 734 | 87.2% | 6/6 | 六边形交付：静态长前缀，缓存收益最大 |
| harmony-chat-ops | 647 | 523 | 97.9% | 5/6 | 任务管家：静态前缀 + 调度 |
| harmony-chat-rampagemax | 1117 | 854 | 89.9% | 5/6 | 狂暴：运行上下文+fetch 全开，质量优先 |

## 缓存命中说明

同一系统提示在 DeepSeek 直连 API 连发 4 次加温，取第 4 次稳态的前缀命中 token 比例：
- **前缀稳定**的预设（pro/promax/ops）命中率应最高，前缀每轮请求完全一致。
- **运行上下文开启**的预设（harmony-chat/rampagemax）在实际 dsh 会话中前缀会随快照变化，此处测的是理想静态前缀基线，真实命中率会低于此值。

## 题级明细

### harmony-chat

- math1: ✅ 
- math2: ✅ 
- code1: ✅ 
- logic1: ✅ 
- fact1: ✅ 
- fact2: ✅ 

### harmony-chat-pro

- math1: ✅ 
- math2: ✅ 
- code1: ✅ 
- logic1: ✅ 
- fact1: ✅ 
- fact2: ✅ 

### harmony-chat-promax

- math1: ✅ 
- math2: ✅ 
- code1: ✅ 
- logic1: ✅ 
- fact1: ✅ 
- fact2: ✅ 

### harmony-chat-ops

- math1: ❌ 
- math2: ✅ 
- code1: ✅ 
- logic1: ✅ 
- fact1: ✅ 
- fact2: ✅ 

### harmony-chat-rampagemax

- math1: ❌ 
- math2: ✅ 
- code1: ✅ 
- logic1: ✅ 
- fact1: ✅ 
- fact2: ✅ 
