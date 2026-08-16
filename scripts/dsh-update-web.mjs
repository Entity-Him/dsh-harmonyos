#!/usr/bin/env node
// dsh 设置与更新页：127.0.0.1:3098。内嵌 HTML，零依赖。
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { check, install, isUp } from './dsh-update.mjs';

const HOME = homedir();
const LOG = join(HOME, 'dsh-update.log');
const PORT = 3098;

const HTML = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>dsh 设置与更新</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#0b1220;color:#eaf6ff;margin:0;display:grid;place-items:center;min-height:100vh}
.card{width:min(430px,92vw);background:#111c34;border:1px solid rgba(125,211,252,.35);border-radius:18px;padding:26px 28px;box-shadow:0 18px 50px rgba(0,0,0,.5)}
h1{font-size:18px;margin:0 0 4px}.sub{font-size:12px;opacity:.7;margin-bottom:18px}
.row{display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07);font-size:14px}
.row .k{opacity:.75}
.ok{color:#22c55e}.warn{color:#f59e0b}.err{color:#ef4444}
.btns{display:flex;gap:10px;margin-top:20px}
button{flex:1;border:none;border-radius:10px;padding:11px;font-size:14px;cursor:pointer;color:#fff}
#check{background:linear-gradient(135deg,#0ea5e9,#2563eb)}
#upgrade{background:linear-gradient(135deg,#f59e0b,#ea580c)}
button:disabled{opacity:.5;cursor:not-allowed}
#msg{margin-top:14px;font-size:12px;opacity:.85;white-space:pre-wrap;max-height:180px;overflow:auto;line-height:1.6}
</style></head><body>
<div class="card">
<h1>dsh 设置与更新</h1><p class="sub">本地核心包 · http://127.0.0.1:3080</p>
<div class="row"><span class="k">服务状态</span><span id="srv">…</span></div>
<div class="row"><span class="k">已装版本</span><span id="inst">…</span></div>
<div class="row"><span class="k">最新版本</span><span id="lat">…</span></div>
<div class="row"><span class="k">状态</span><span id="state">…</span></div>
<div class="btns"><button id="check">检查更新</button><button id="upgrade" disabled>升级并重启</button></div>
<div id="msg"></div>
</div>
<script>
const $=s=>document.querySelector(s);
let busy=false;
async function refresh(fresh){
  try{
    const r=await fetch('/api/status'+(fresh?'?fresh=1':''));
    const st=await r.json();
    $('#srv').textContent=st.running?'运行中':'未运行';
    $('#srv').className=st.running?'ok':'warn';
    $('#inst').textContent=st.installed||'—';
    $('#lat').textContent=st.latest||'—';
    const up=st.installed&&st.installed===st.latest;
    $('#state').textContent=up?'已是最新':(st.updateRunning?'升级中…':'有更新');
    $('#state').className=up?'ok':'warn';
    $('#upgrade').disabled=busy||st.updateRunning||!st.installed;
    $('#msg').textContent=st.updateRunning?'升级进行中，请稍候……':(st.lastResult?JSON.stringify(st.lastResult,null,2):'');
  }catch(e){$('#state').textContent='连接失败';$('#state').className='err';}
}
$('#check').onclick=()=>refresh(true);
$('#upgrade').onclick=async()=>{
  if(busy)return;
  if(!confirm('确认升级 dsh 到最新版并重启服务？'))return;
  busy=true; $('#upgrade').disabled=true;
  await fetch('/api/update',{method:'POST'});
  refresh(true);
  const poll=setInterval(async()=>{
    const st=await (await fetch('/api/status?fresh=1')).json();
    busy=false;
    refresh(true);
    if(!st.updateRunning&&st.lastResult)clearInterval(poll);
  },2000);
};
refresh();setInterval(refresh,30000);
</script></body></html>`;

let cache = null; // 版本检查结果缓存 10s
function getCheck(fresh) {
  if (!fresh && cache && Date.now() - cache.at < 10000) return cache.data;
  const data = check();
  cache = { at: Date.now(), data };
  return data;
}
function logTail(n = 40) {
  try {
    const lines = readFileSync(LOG, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-n).join('\n');
  } catch { return '(暂无日志)'; }
}

let updateRunning = false;
let lastResult = null;
async function doUpdate() {
  updateRunning = true;
  try { lastResult = { time: new Date().toISOString(), ...(await install()) }; }
  catch (e) { lastResult = { time: new Date().toISOString(), ok: false, error: (e && e.message) || String(e) }; }
  finally { updateRunning = false; cache = null; }
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  let u;
  try { u = new URL(req.url, 'http://local'); } catch { res.writeHead(400); res.end(); return; }
  if (req.method === 'GET' && u.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML); return;
  }
  if (req.method === 'GET' && u.pathname === '/api/status') {
    const running = await isUp();
    let st = { running, updateRunning, lastResult };
    try { st = { ...st, ...getCheck(u.searchParams.get('fresh') === '1') }; }
    catch (e) { st.error = (e && e.message) || String(e); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(st)); return;
  }
  if (req.method === 'POST' && u.pathname === '/api/update') {
    if (updateRunning) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: '升级进行中' })); return;
    }
    doUpdate();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, started: true })); return;
  }
  if (req.method === 'GET' && u.pathname === '/api/update-log') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(logTail()); return;
  }
  res.writeHead(404); res.end('Not Found');
});
server.listen(PORT, '127.0.0.1', () => console.log('dsh settings: http://127.0.0.1:' + PORT + '/'));
