// 鸿蒙五套对话预设跑分（2026-08-18）
// 用 opencode-go API（免费，cost:0）测：前缀 token 成本、缓存命中率、基准题正确率。
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

// 基准题集：可自动判分（答案校验函数 + 参考答案）
const TASKS = [
  {
    id: 'math1', type: 'math', q: '12345 × 6789 等于多少？只回数字。',
    check: (s) => (s.replace(/[^\d]/g, '').slice(0, 12) === '83810205' ? 1 : 0),
  },
  {
    id: 'math2', type: 'math', q: '从1加到100的和是多少？只回数字。', check: (s) => (s.includes('5050') ? 1 : 0),
  },
  {
    id: 'code1', type: 'code', q: '用 JavaScript 写一个函数 isPrime(n)，判断 n 是否为质数，要求处理 n<=1 返回 false。',
    check: (s) => {
      const ok = /function\s+isPrime/.test(s) && /n\s*[<>]=?\s*1|1\s*[<>]=?\s*n|n\s*<=\s*1|n\s*< 2/.test(s);
      return ok ? 1 : 0;
    },
  },
  {
    id: 'logic1', type: 'logic', q: '如果所有的 A 都是 B，所有的 B 都是 C，那么以下哪个必然成立？A) 所有 A 都是 C  B) 所有 C 都是 A  C) 所有 B 都是 A  D) 无法判断。只回选项字母。',
    check: (s) => (s.trim().startsWith('A') ? 1 : 0),
  },
  {
    id: 'fact1', type: 'fact', q: '中国最长的河流是哪条？只回河名。', check: (s) => (s.includes('长江') || s.includes('Yangtze') ? 1 : 0),
  },
  {
    id: 'fact2', type: 'fact', q: '光在真空中的速度约是多少？只回数字（单位 km/s）。',
    check: (s) => (/^(299792|300000)/.test(s.replace(/[^\d]/g, '')) ? 1 : 0),
  },
];

// 轻量系统提示：固定「只回答案」约束，便于判分
const ANSWER_HINT = '\n\n规则：回答要简洁，直接给出答案本身，不要长篇解释。';

const TIMEOUT = 90000;
async function call(messages, maxTokens = 200) {
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

  // ② 基准题正确率（失败重试一次）
  let correct = 0;
  const taskResults = [];
  for (const t of TASKS) {
    const msg = [{ role: 'system', content: sys + ANSWER_HINT }, { role: 'user', content: t.q }];
    let j = null, lastErr = '';
    for (let attempt = 1; attempt <= 2 && !j; attempt++) {
      try { j = await call(msg); } catch (e) { lastErr = e.message; await sleep(600); }
    }
    if (!j) { taskResults.push({ id: t.id, ok: 0, err: lastErr }); continue; }
    const out = j.choices?.[0]?.message?.content || '';
    const ok = t.check(out);
    if (ok) correct++;
    taskResults.push({ id: t.id, ok, out: out.slice(0, 120) });
    await sleep(300);
  }

  const entry = {
    name,
    personaChars: persona.length,
    systemPrompt: sys.length,
    firstPromptTokens: cacheHits[0]?.prompt ?? 0,
    cacheHitTokens: last.hit,
    cacheHitRate: Number(hitRate.toFixed(4)),
    tasksCorrect: correct,
    tasksTotal: TASKS.length,
    taskDetails: taskResults,
  };
  console.log(`前缀token: ${entry.firstPromptTokens} | 缓存命中率: ${(hitRate * 100).toFixed(1)}% | 正确率: ${correct}/${TASKS.length}`);
  return entry;
}

const results = [];
for (const name of ['harmony-chat', 'harmony-chat-pro', 'harmony-chat-promax', 'harmony-chat-ops', 'harmony-chat-rampagemax']) {
  try { results.push(await runPreset(name)); }
  catch (e) { console.error(`${name} 跑分失败:`, e.message); results.push({ name, error: e.message }); }
}

fs.writeFileSync('result.json', JSON.stringify(results, null, 2));
console.log('\n原始结果已写 result.json');

// 报告
function fmtPct(x) { return (x * 100).toFixed(1) + '%'; }
const lines = [];
lines.push('# 鸿蒙五套对话预设跑分报告');
lines.push('');
lines.push(`> 跑分引擎: 基准题走 opencode-go API（模型 ${MODEL}，免费 cost:0）；缓存命中走 DeepSeek 直连 API（同模型，准确）。日期 2026-08-18。基准题 ${TASKS.length} 道，每套预设同前缀连发 4 次（前 3 次加温）测第 4 次稳态缓存命中。`);
lines.push('');
lines.push('## 总览');
lines.push('');
lines.push('| 预设 | persona 字符 | 系统提示 token | 缓存命中率 | 正确率 | 说明 |');
lines.push('|---|---|---|---|---|---|');
const desc = {
  'harmony-chat': '基础：运行上下文开，前缀易变',
  'harmony-chat-pro': '缓存极致：complete + 静态前缀最短',
  'harmony-chat-promax': '六边形交付：静态长前缀，缓存收益最大',
  'harmony-chat-ops': '任务管家：静态前缀 + 调度',
  'harmony-chat-rampagemax': '狂暴：运行上下文+fetch 全开，质量优先',
};
for (const r of results) {
  if (r.error) { lines.push(`| ${r.name} | — | — | — | — | ❌ 跑分失败: ${r.error} |`); continue; }
  lines.push(`| ${r.name} | ${r.personaChars} | ${r.firstPromptTokens} | ${fmtPct(r.cacheHitRate)} | ${r.tasksCorrect}/${r.tasksTotal} | ${desc[r.name] || ''} |`);
}
lines.push('');
lines.push('## 缓存命中说明');
lines.push('');
lines.push(`同一系统提示在 DeepSeek 直连 API 连发 4 次加温，取第 4 次稳态的前缀命中 token 比例：
- **前缀稳定**的预设（pro/promax/ops）命中率应最高，前缀每轮请求完全一致。
- **运行上下文开启**的预设（harmony-chat/rampagemax）在实际 dsh 会话中前缀会随快照变化，此处测的是理想静态前缀基线，真实命中率会低于此值。`);
lines.push('');
lines.push('## 题级明细');
lines.push('');
for (const r of results) {
  lines.push(`### ${r.name}`);
  lines.push('');
  if (r.error) { lines.push(`- 跑分失败: ${r.error}`); lines.push(''); continue; }
  for (const t of r.taskDetails) {
    lines.push(`- ${t.id}: ${t.ok ? '✅' : '❌'} ${t.err ? '(err: ' + t.err + ')' : ''}`);
  }
  lines.push('');
}
fs.writeFileSync('result.md', lines.join('\n'));
console.log('报告已写 result.md');
