// 鸿蒙五套对话预设「六边形」跑分（2026-08-18 v2）
// 能力雷达：数学/代码/逻辑/事实/规划/自我修正 6 轴 × 2 题，客观判分（0-100）。
// 性能表：缓存命中率（DeepSeek 直连准确测）+ 输出效率（每道正确题 completion tokens 中位数）。
// 正确率走 opencode-go API（免费，cost:0）；缓存命中走 DeepSeek 直连 API（同模型）。
// 输出：result.json（原始）+ result.md（人读报告）
import fs from 'node:fs';
import { load as loadYaml } from '/storage/Users/currentUser/.dsh/profiles/node_modules/js-yaml/index.js';

const CRED = fs.readFileSync('/storage/Users/currentUser/.dsh/.credentials.yaml', 'utf8');
const OKEY = CRED.match(/OPENCODE_GO_API_KEY:\s*(\S+)/)?.[1];
const DKEY = CRED.match(/DEEPSEEK_API_KEY:\s*(\S+)/)?.[1];
if (!OKEY || !DKEY) { console.error('缺 OPENCODE_GO_API_KEY / DEEPSEEK_API_KEY'); process.exit(1); }

const BASE = '/storage/Users/currentUser/dsh-harmonyos/presets/';
const MODEL = process.env.BENCH_MODEL || 'deepseek-v4-flash';
const API = 'https://opencode.ai/zen/go/v1/chat/completions';
const PREAMBLE = 'You are an AI agent powered by DeepSeek Harness.\n\n';

// 每套预设的系统提示组装（复刻 CACHE-OPTIMIZATION.md 的 band 结构）
function assembleSystem(name, persona) {
  const plan = `
[计划策略]
You are in normal mode. For non-trivial changes follow the full loop: precheck -> implement -> integrate -> verify.
`;
  const tools = `
[工具指引]
tool-fs: file editing. tool-skill: load skills. tool-goal: manage goals. tool-subagent: delegate complex tasks. tool-web: web search.
[Agent Instructions]
Understand before acting, keep changes restrained, verify continuously.`;
  // pro: complete:true -> persona 是唯一系统提示段，其余被抑制（短前缀）
  if (name === 'harmony-chat-pro') return persona;
  // 其余保留完整提示段（长前缀）
  return PREAMBLE + persona + plan + tools;
}

// ── 六边形能力轴 ────────────────────────────────────────────────────────────
const AXES = ['数学', '代码', '逻辑', '事实', '规划', '自我修正'];

// 12 道客观判分题：6 轴 × 2 题。
// terse:true 纯答案题，用「只输出答案」提示便于判分；陷阱/验证题 terse:false，
// 用「按正常工作准则回答」中性提示——让各预设 persona 的立身纪律（预检/验证/结构化）自主浮现。
const TASKS = [
  // 数学：直算 + 求和
  { id: 'm1', axis: '数学', terse: true, q: '计算 12345 × 6789，只给出结果数字。',
    check: (s) => (s.replace(/[^\d]/g, '').slice(0, 12) === '83810205' ? 1 : 0) },
  { id: 'm2', axis: '数学', terse: true, q: '求 1 加到 100 的和。',
    check: (s) => (s.includes('5050') ? 1 : 0) },
  // 代码：边界条件守卫 + 读码
  { id: 'c1', axis: '代码', terse: false, q: '用 JavaScript 写 isPrime(n) 判断素数。',
    check: (s) => (/(n\s*<=\s*1|n\s*<\s*2|1\s*>=\s*n)/.test(s) && /false/.test(s)) ? 1 : 0 },
  { id: 'c2', axis: '代码', terse: true, q: 'const f = n => n <= 1 ? n : f(n-1) + f(n-2); console.log(f(5)); 这段代码输出什么？只输出结果数字。',
    check: (s) => (s.replace(/[^\d]/g, '') === '5' ? 1 : 0) },
  // 逻辑：传递推理 + 除零陷阱
  { id: 'l1', axis: '逻辑', terse: true, q: '已知 A 大于 B，且 B 大于 C。三者中最大的是哪个？只回答一个字母。',
    check: (s) => (s.trim().startsWith('A') ? 1 : 0) },
  { id: 'l2', axis: '逻辑', terse: false, q: '计算 x ÷ x，其中 x = 42 − 42。',
    check: (s) => (/0/.test(s) && /不能|无意义|不存在|未定义|undefined|NaN|无法|除.{0,4}0/.test(s)) ? 1 : 0 },
  // 事实：地名 + 常量
  { id: 'f1', axis: '事实', terse: true, q: '中国最长的河流是哪条？只回河名。',
    check: (s) => (/长江|Yangtze/i.test(s) ? 1 : 0) },
  { id: 'f2', axis: '事实', terse: true, q: '光在真空中的速度约是多少？只回数字（单位 km/s）。',
    check: (s) => (/(299792|300000)/.test(s.replace(/[^\d]/g, '')) ? 1 : 0) },
  // 规划：最优硬币组合 + 多约束日程
  { id: 'p1', axis: '规划', terse: false, q: '用面额 25、10、5、1 的硬币凑 47 元，求最少硬币数及硬币组合，并验证合计为 47。',
    check: (s) => ((/(5\s*(枚|个))/.test(s) || /最少.{0,12}5/.test(s)) && /\b47\b/.test(s)) ? 1 : 0 },
  { id: 'p2', axis: '规划', terse: false, q: '会议需要小明和小红都参加。小明周一、周三、周五有空，小红周二、周四有空。哪天能开会？',
    check: (s) => (/没有|不存在|无共同|不行|无法|没有共同|none|no common/i.test(s) ? 1 : 0) },
  // 自我修正：浮点陷阱 + 验证步骤（不给验证提示，测立身纪律）
  { id: 's1', axis: '自我修正', terse: false, q: '0.1 + 0.2 等于 0.3 吗？',
    check: (s) => (/不等于|不是|0\.30000000000000004|0\.30000000000004/.test(s) ? 1 : 0) },
  { id: 's2', axis: '自我修正', terse: false, q: '有人说 2 的 10 次方等于 2048。这个说法正确吗？',
    check: (s) => (/1024/.test(s) && /错|不对|不是|不正确|并非/.test(s)) ? 1 : 0 },
];

// 分题提示：纯答案题「只输出答案」，其余「按正常工作准则回答」让 persona 纪律浮现
const HINT_TERSE = '\n\n规则：只输出答案本身，不要解释。';
const HINT_NORM = '\n\n规则：按你的正常工作准则回答。';

// 交付规范贯彻度：3 道流程题，测 persona 的交付纪律是否内化（软链/重启/核对/实测/复盘等）。
// 标记命中越多分越高——promax/rampagemax persona 明文含这些流程，理应明显高于简洁预设。
const W_TASKS = [
  { id: 'W1', name: '集成闭环', q: '你在 dsh 插件环境交付一个新插件。写出你从写完代码到确认生效的完整步骤。',
    checks: [/软链|symlink/, /重启|restart/, /加载|boot/, /实测|验证|核对|测试/], max: 4 },
  { id: 'W2', name: '验证先于完成', q: '改动代码后，你用什么证据向人证明完成？列出你的验证方法。',
    checks: [/语法|--check|lint|检查/, /测试|test/, /重启/, /实测|运行|跑/], max: 4 },
  { id: 'W3', name: '复盘收尾', q: '任务完成后，你还会做什么收尾工作？',
    checks: [/复盘|反思|改进|review|retrospective/, /记录|留痕|报告|整理/, /审查|复核|复查|自查/], max: 3 },
];

const TIMEOUT = 90000;
async function call(messages, maxTokens = 800) {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: maxTokens }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j;
}

// 缓存命中探针：走 DeepSeek 直连（准确返回 prompt_cache_hit_tokens），同一模型。
async function cacheProbe(messages) {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + DKEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages, max_tokens: 50 }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runPreset(name) {
  const doc = loadYaml(fs.readFileSync(BASE + name + '/agent.cordis.yml', 'utf8'));
  const persona = doc.find(r => r.id === 'persona').config.text;
  const sys = assembleSystem(name, persona);
  const t0 = Date.now();
  console.log(`\n========== ${name} ==========`);

  // ① 前缀缓存命中率：同一系统提示连发 4 次（前 3 次加温，测第 4 次稳态命中），DeepSeek 直连
  const cacheMsg = [{ role: 'system', content: sys }, { role: 'user', content: '2+3等于几？只回数字。' }];
  const cacheHits = [];
  for (let i = 0; i < 4; i++) {
    const j = await cacheProbe(cacheMsg);
    cacheHits.push({ prompt: j.usage?.prompt_tokens ?? 0, hit: j.usage?.prompt_cache_hit_tokens ?? 0, miss: j.usage?.prompt_cache_miss_tokens ?? 0 });
    await sleep(300);
  }
  const last = cacheHits[cacheHits.length - 1];
  const hitRate = last.prompt > 0 ? last.hit / last.prompt : 0;

  // ② 六边形能力题（最多 3 次尝试，空内容/报错均重试）
  let correct = 0;
  const taskResults = [];
  const tokens = [];
  const RE_VERIF = /验证|校验|复核|确认|检查|verify|check/i;
  const RE_RETRO = /复盘|反思|自查|可改进|improve/i;
  for (const t of TASKS) {
    const msg = [{ role: 'system', content: sys + (t.terse ? HINT_TERSE : HINT_NORM) }, { role: 'user', content: t.q }];
    let out = '', ctk = null, lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const j = await call(msg);
        out = j.choices?.[0]?.message?.content || '';
        ctk = j.usage?.completion_tokens ?? Math.round(out.length / 3.5); // 兜底估算
        if (out.trim()) break;
        lastErr = 'empty-response';
      } catch (e) { lastErr = e.message; }
      await sleep(600);
    }
    if (!out.trim()) { taskResults.push({ id: t.id, axis: t.axis, ok: 0, err: lastErr }); continue; }
    const ok = t.check(out);
    if (ok) { correct++; tokens.push(ctk); }
    taskResults.push({ id: t.id, axis: t.axis, ok, ctk, verif: RE_VERIF.test(out), retro: RE_RETRO.test(out), out: out.slice(0, 160) });
    await sleep(300);
  }

  // 交付质量：输出中的验证/复盘留痕占比（测立身纪律是否真正体现在输出里）
  const verifRate = Math.round(taskResults.filter(x => x.verif).length / taskResults.length * 100);
  const retroRate = Math.round(taskResults.filter(x => x.retro).length / taskResults.length * 100);

  // ③ 交付规范贯彻度：3 道流程题，按标记命中打分
  const delivery = {};
  for (const w of W_TASKS) {
    const msg = [{ role: 'system', content: sys + HINT_NORM }, { role: 'user', content: w.q }];
    let out = '', lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { const j = await call(msg, 1600); out = j.choices?.[0]?.message?.content || ''; if (out.trim()) break; lastErr = 'empty'; }
      catch (e) { lastErr = e.message; }
      await sleep(500);
    }
    const hit = w.checks.filter(re => re.test(out)).length;
    delivery[w.id] = { name: w.name, score: Math.round(hit / w.max * 100), out: out.slice(0, 160) };
    await sleep(250);
  }
  const deliveryNorm = Math.round((delivery.W1.score + delivery.W2.score + delivery.W3.score) / 3);

  // 轴得分 = 该轴通过题数 / 题数 × 100
  const axisScores = {};
  for (const ax of AXES) {
    const ts = taskResults.filter(x => x.axis === ax);
    axisScores[ax] = ts.length ? Math.round(ts.filter(x => x.ok).length / ts.length * 100) : 0;
  }
  const axisMean = Math.round(AXES.reduce((a, ax) => a + axisScores[ax], 0) / AXES.length);

  const eff = tokens.length ? Math.round(tokens.sort((a, b) => a - b)[Math.floor(tokens.length / 2)]) : null;

  const entry = {
    name,
    personaChars: persona.length,
    systemPrompt: sys.length,
    firstPromptTokens: cacheHits[0]?.prompt ?? 0,
    cacheHitTokens: last.hit,
    cacheHitRate: Number(hitRate.toFixed(4)),
    axes: axisScores,
    axisMean,
    effTokensPerCorrect: eff,
    deliveryNorm,
    delivery,
    verifRate,
    retroRate,
    tasksCorrect: correct,
    tasksTotal: TASKS.length,
    elapsedMs: Date.now() - t0,
    taskDetails: taskResults,
  };
  console.log(`前缀token: ${entry.firstPromptTokens} | 缓存命中率: ${(hitRate * 100).toFixed(1)}% | 正确率: ${correct}/${TASKS.length} | 综合: ${axisMean} | 效率: ${eff} tok/正确题 | 交付规范: ${deliveryNorm} | 验证留痕: ${verifRate}% | 复盘留痕: ${retroRate}% | 耗时: ${(entry.elapsedMs / 1000).toFixed(0)}s`);
  return entry;
}

// 支持子集冒烟：BENCH_ONLY=preset  BENCH_TASKS=m1,l2
const ONLY = (process.env.BENCH_ONLY || '').split(',').filter(Boolean);
const TASKS_ONLY = (process.env.BENCH_TASKS || '').split(',').filter(Boolean);
const TASK_SET = TASKS_ONLY.length ? TASKS.filter(t => TASKS_ONLY.includes(t.id)) : TASKS;
if (TASK_SET.length !== TASKS.length) {
  // 冒烟：只跑指定题，不重写全局 TASKS（轴得分逻辑照常按题算）
  TASKS.length = 0; TASKS.push(...TASK_SET);
}

const NAMES = ['harmony-chat', 'harmony-chat-pro', 'harmony-chat-promax', 'harmony-chat-ops', 'harmony-chat-rampagemax'];
const RUN = ONLY.length ? NAMES.filter(n => ONLY.includes(n)) : NAMES;

const results = [];
for (const name of RUN) {
  try { results.push(await runPreset(name)); }
  catch (e) { console.error(`${name} 跑分失败:`, e.message); results.push({ name, error: e.message }); }
}

fs.writeFileSync('result.json', JSON.stringify(results, null, 2));
console.log('\n原始结果已写 result.json');

// ── 报告 ────────────────────────────────────────────────────────────────────
function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }
const lines = [];
lines.push('# 鸿蒙五套对话预设「六边形」跑分报告');
lines.push('');
lines.push(`> 跑分引擎：能力题走 opencode-go API（模型 ${MODEL}，免费 cost:0）；缓存命中走 DeepSeek 直连 API（同模型，准确）。日期 2026-08-18。六边形 = 数学/代码/逻辑/事实/规划/自我修正 6 轴 × 2 题，每轴 0-100；性能表 = 缓存命中率 + 输出效率（每道正确题的输出 token 中位数，越低越省）；交付质量表 = 3 道流程题（集成闭环/验证先于完成/复盘收尾）按交付步骤标记命中打分，测 persona 交付纪律贯彻度。`);
lines.push('');
lines.push('## 六边形能力雷达');
lines.push('');
lines.push('| 预设 | ' + AXES.join(' | ') + ' | 综合 |');
lines.push('|' + Array(AXES.length + 2).fill('---').join('|') + '|');
for (const r of results) {
  if (r.error) { lines.push(`| ${r.name} | ❌ 跑分失败: ${r.error} |`); continue; }
  const cells = AXES.map(a => r.axes[a] ?? 0).map(v => v === 100 ? `**${v}**` : v);
  lines.push(`| ${r.name} | ${cells.join(' | ')} | **${r.axisMean}** |`);
}
lines.push('');
lines.push('## 性能表');
lines.push('');
lines.push('| 预设 | 缓存命中率 | 输出效率（中位 tok/正确题） | 前缀 token | 参考:平均耗时 |');
lines.push('|---|---|---|---|---|');
for (const r of results) {
  if (r.error) { lines.push(`| ${r.name} | — | — | — | ❌ |`); continue; }
  lines.push(`| ${r.name} | ${fmtPct(r.cacheHitRate)} | ${r.effTokensPerCorrect ?? '—'} | ${r.firstPromptTokens} | ${(r.elapsedMs / 1000).toFixed(0)}s |`);
}
lines.push('');
lines.push('## 交付质量（交付规范贯彻度）');
lines.push('');
lines.push('| 预设 | 集成闭环 W1 | 验证先于完成 W2 | 复盘收尾 W3 | 综合 |');
lines.push('|---|---|---|---|---|');
for (const r of results) {
  if (r.error) { lines.push(`| ${r.name} | — | — | — | — |`); continue; }
  lines.push(`| ${r.name} | ${r.delivery?.W1?.score ?? 0} | ${r.delivery?.W2?.score ?? 0} | ${r.delivery?.W3?.score ?? 0} | **${r.deliveryNorm ?? 0}** |`);
}
lines.push('');
lines.push('## 读法说明');
lines.push('');
lines.push('- **缓存命中率**：同一系统提示在 DeepSeek 直连 API 连发 4 次加温，取第 4 次稳态的前缀命中比例。DeepSeek 前缀缓存按 **128 token 块**计费：命中数恒为 `128 × ⌊prompt/128⌋`，尾部 `prompt mod 128` 必按未命中算。填充静态 persona 使前缀刚好越过块边界（余数 ≤15），命中率可逼近 100%。');
lines.push('- **输出效率**：每道正确题的输出 token 中位数。数值低 = 同样的答案更省输出 token（输出单价最高）。promax 的「结论先行、精简输出」纪律应在此领先。');
lines.push('- **规划 / 自我修正轴**：陷阱题（除零、无共同日程、浮点、需独立验证）测「先判断再作答、验证再交付」的纪律，promax/rampagemax 的预检与验证条款应在此拉开差距。');
lines.push('- 运行上下文预设（harmony-chat/rampagemax）实测会话中前缀会随快照变化，此处测的是理想静态前缀基线，真实命中率会略低。');
lines.push('');
lines.push('## 题级明细');
lines.push('');
for (const r of results) {
  lines.push(`### ${r.name}`);
  lines.push('');
  if (r.error) { lines.push(`- 跑分失败: ${r.error}`); lines.push(''); continue; }
  for (const t of r.taskDetails) {
    lines.push(`- ${t.id} [${t.axis}]: ${t.ok ? '✅' : '❌'}${t.err ? ' (err: ' + t.err + ')' : ''} ${t.ctk ? '(' + t.ctk + ' tok)' : ''} ${t.out ? '→ ' + t.out.replace(/\n/g, ' ') : ''}`);
  }
  lines.push('');
}
fs.writeFileSync('result.md', lines.join('\n'));
console.log('报告已写 result.md');
