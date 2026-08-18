[简体中文](CACHE-OPTIMIZATION.md) | **English**

# Why the cache hit rate differs across the five presets

DeepSeek's cache is **prefix matching**: the portion of the first N tokens of each request that is byte-for-byte identical to the previous request is served directly from cache (about 1/10 the price, low latency). So the only optimization goal is — **keep the request prefix byte-for-byte unchanged across the session's lifetime, and make it as long as possible**.

## Measured data

| Prefix scenario | Result |
|---|---|
| Short prefix (115 token), changes every request | 0 hits |
| Long fixed prefix (2701 token), unchanged from the second request onward | hit 2688/2701 ≈ **99.5%** |

Conclusion: **the hit rate is determined by prefix stability, not prefix length**. The moment dynamically injected content (dates, recent file snapshots, runtime state) appears, the cache is invalidated as a whole starting from the first changed token.

> Note on methodology: the 99.5% above is the **per-token exact-hit** ratio; DeepSeek actually bills in **128-token blocks**, and the trailing `prompt mod 128` is always billed as a cache miss, so the steady-state hit rate in the README's "performance benchmarks" (93.8–98.0%) is slightly lower than the per-token value — same mechanism, different metric.

## What's in the prefix

dsh's system prompt for each request is assembled from these parts (concatenated in fixed-order bands):

```
-100   harness identity ("You are an AI agent powered by DeepSeek Harness.")
  0    persona (deployment:persona segment)
 50    plan:policy (instruction segment active in plan mode)
100-199  tool instruction segments (static prose)
---   tool schema (independent wire field, not part of the prompt bands) ---
```

The tool schema is a separate wire field, so **adding tools does not break the prefix**; what really breaks the cache is the dynamic runtime context snapshot.

## Key switches

### `includeRuntimeContext: false` (the decisive one)

With it off, requests no longer inject a dynamic runtime context snapshot (policy snapshots for sandbox/approval/delegation, etc.), and only then does the prefix truly stabilize. **This is the core switch for cache optimization.**

### `complete: true` (for pro)

Makes persona the **only** system prompt segment; after assembly, all other prompt segment text (harness identity, plan:policy, tool instructions) is suppressed.

| | `complete:false` | `complete:true` |
|---|---|---|
| Prompt segments | All retained | Only persona remains |
| Prefix | Long and stable | Short and stable |
| Hit rate | ≈99.5% | ≈99.5% |
| Tokens cached per turn | **More** (long prompt) | Fewer (short prompt) |
| Plan policy / tool instructions | Retained | Suppressed, must be written into persona |
| Tool schema / agent-instructions | Unaffected | Unaffected |

`complete:true` does not suppress the tool schema (an independent wire field), nor does it suppress `agent-instructions` (injected as a user-role historical message, not a system prompt segment). It only suppresses **prompt segment text**.

### A small gotcha

`dsh-plan-mode`'s `section` config **requires a non-empty string**; if missing, mount fails with `PlanModeConfig needs a string section` — even though the segment is suppressed under `complete:true`, the config validation still requires it to exist.

## Trade-offs across the five presets

First, the big picture — the cache switches and measured static baseline hit rates of the five presets (benchmarked 2026-08-18, see the README's "performance benchmarks"):

| Preset | `includeRuntimeContext` | `complete` | Cache archetype | Measured static baseline hit rate |
|---|---|---|---|---|
| `harmony-chat` (basic) | ✅ On | false | Baseline: prefix changes with snapshots | 93.8% |
| `harmony-chat-pro` (cache-optimized) | false | ✅ true | Single prompt segment: short stable prefix | 94.6% |
| `harmony-chat-promax` (strongest delivery) | false | false | Long stable prefix | 96.7% |
| `harmony-chat-ops` (task steward) | false | false | Long stable prefix (same as promax) | 97.9% |
| `harmony-chat-rampagemax` (Rampage Max) | ✅ On | false | Baseline: prefix changes with snapshots | 98.0% (ideal static baseline) |

### Basic `harmony-chat`
Compared to the standard preset, it only drops tools that depend on native APIs; everything else is unchanged — **runtime context is on**, so the prefix changes with snapshots and the cache hit rate is not ideal. It is the baseline.

### HarmonyOS Chat Mode Pro `harmony-chat-pro` (cache-optimized)
- `complete: true` + `includeRuntimeContext: false`
- System prompt compressed into a **single persona segment**, zero change across the session lifetime → hit-rate ceiling
- Smallest per-turn request body, lowest time-to-first-token
- Cost: plan:policy and tool instruction segments are suppressed, so **planning discipline and delivery guidelines are written directly into the persona text** (see `presets/harmony-chat-pro/agent.cordis.yml`); when entering plan mode, the model still receives a user-role "switched to plan mode" notification
- Best for: everyday tasks, quick file edits, maximizing savings

### HarmonyOS Chat Mode ProMax `harmony-chat-promax` (strongest delivery)
- `complete: false` + `includeRuntimeContext: false`
- Keeps the full prompt segments (harness identity + persona + plan:policy + tool instructions) → **long stable prefix**, more tokens cached per turn, cheaper in the long run
- On top of that it adds a **delegation group** (all pure JS, runs on HarmonyOS): `subagent` / `subagent_fork` in-process parallel subagents, `workflow` workflows, `ralph` up to 64 rounds of autonomous iteration
- **Delegated subagents route to Pro**: `agentOptions: {provider: deepseek-official, model: deepseek-v4-pro, maxTokens: 384000}` — the main loop stays cheap and fast on flash, while complex reasoning subtasks are automatically handed to Pro's native deep thinking as a safety net
- Persona bakes in the **delivery discipline**: write everything in one pass before landing, don't search for local knowledge, delegate complex tasks to subagents
- Best for: complex tasks, multi-file refactors, parallel delivery needs

### HarmonyOS Task Steward `harmony-chat-ops` (resident background)
- Cache strategy same as promax: `includeRuntimeContext: false` + `complete: false` → **long stable prefix**
- Responsibilities go beyond chat: knowledge curation (read directories → extract → dedupe → archive to `~/dsh-kb/`), batch file processing, scheduled reports; the tool surface adds time scheduling (`schedule_create/list/delete`) + directory enumeration (`list_dir`)
- Prefix is 523 tokens with a static baseline hit rate of 97.9% — suited to unattended background tasks

### HarmonyOS Rampage Max `harmony-chat-rampagemax` (doesn't save tokens, only quality matters)
- Cache strategy on the same side as harmony-chat: `includeRuntimeContext: true` (runtime context on) — the prefix changes with snapshots, the real hit rate drops, a deliberate trade-off of "sacrificing cache for quality"
- `complete: false` + web scraping fully on (`fetch:true`) + exhaustive pre-check scans + double verification + mandatory retrospectives
- Prefix is 914 tokens, ideal static baseline 98.0% but drops in practice; **use with caution**: high token consumption that can burn through the account quota in one go, only for attacking hard problems / cross-file refactors / final pre-delivery checks

## Saving tokens × delivery efficiency measured (2026-08-17, 11 benchmark headless)

Three-level A/B results for `agent-default-model.reasoningEffort`:

| effort | Correctness | Steps (requests) | Input | Avg thinking time | Cost |
|---|---|---|---|---|---|
| `off` | 10/11 (T1 math wrong) | 52 | 329K | 6.1s | ¥0.052 |
| **`high`** ✅ | **11/11** | **34** | **151K** | 1.4s | ¥0.067 |
| `max` | 11/11 | 39 | 157K | long | ¥0.067 |

**Conclusion: `high` is the Pareto optimum between saving tokens and getting work done** (¥0.015 more for all-correct results + 35% fewer steps); set it as the default; hard tasks can manually set `max`. The DeepSeek adapter supports `off/low/high/max` (`low` added since 0.1.0-rc.7, default remains `high`); `medium` is not valid.

Reference real session (flashing a system disk, `max`, single task): ¥0.46 / 2.9M input / 95.2K output / 93% cache hit / 2 rounds 36 steps / 27 minutes — **tool call time of 14m56s is a bigger bottleneck than thinking** (the tool schema entering cache as 6-7K hits each time is the bulk).

> The delegation group was never triggered in the measurements (all A/B requests were flash) — Pro routing is insurance, not the main path, and does not change the default cost curve.

## Summary in one sentence

> `includeRuntimeContext: false` guarantees a **stable** prefix (hit rate pushed to the limit) — promax / ops / pro all hit it;
> `complete: true` makes the prefix **shortest** (pro);
> keeping the full prompt segments makes the prefix **longest** (promax / ops get the most per-turn cache benefit);
> harmony-chat / rampagemax with runtime context on have prefixes that change with snapshots and hit rates that drop — the baseline and the deliberate trade-off of "not saving tokens, only quality";
> the tool schemas of all five stay stable, further protecting the cache.
