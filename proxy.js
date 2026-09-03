const http = require('http');
const httpProxy = require('http-proxy');

const PROXY_PORT = process.env.PORT || 8080;
const TARGET_HOST = process.env.TARGET_HOST;

const COOP = 'same-origin';
const COEP = 'require-corp';

// Option B - inject AAD token OR snapshot cron so TV doesn't need login
const TENANT_ID = process.env.TENANT_ID || '46d5db48-8735-4a4d-9260-5ff4c1af6501';
const CLIENT_ID = process.env.CLIENT_ID || '90a76d66-4a84-4d36-ba69-205677c8e84a';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const SCOPE = process.env.SCOPE || 'api://90a76d66-4a84-4d36-ba69-205677c8e84a/.default';
const SNAPSHOT_URL = process.env.SNAPSHOT_URL || 'https://apps.rmhedge.com/reports/indexes';
const SNAPSHOT_COOKIE = process.env.SNAPSHOT_COOKIE || ''; // paste Cookie header from a logged-in browser if you don't want to use CLIENT_SECRET
const SNAPSHOT_INTERVAL_MS = parseInt(process.env.SNAPSHOT_INTERVAL_MS || '300000', 10); // 5m

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (!CLIENT_SECRET) return null;
  if (cachedToken && Date.now() < tokenExpiry - 60000) return cachedToken;
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope: SCOPE,
    grant_type: 'client_credentials',
  });
  const resp = await fetch(`https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Token fetch ${resp.status}: ${txt}`);
  }
  const json = await resp.json();
  cachedToken = json.access_token;
  tokenExpiry = Date.now() + (json.expires_in * 1000);
  console.log(`[${new Date().toISOString()}] Got AAD token expires in ${json.expires_in}s`);
  return cachedToken;
}

// Snapshot cron - fetches private page on server, TV loads cached copy with no auth
let snapshotHtml = null;
let snapshotTime = 0;
let snapshotError = null;

async function fetchSnapshot() {
  try {
    const headers = {};
    if (SNAPSHOT_COOKIE) headers['Cookie'] = SNAPSHOT_COOKIE;
    else if (CLIENT_SECRET) {
      const token = await getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;
    }
    const resp = await fetch(SNAPSHOT_URL, { headers });
    const text = await resp.text();
    if (!resp.ok && !text.includes('<html')) throw new Error(`Snapshot ${resp.status}: ${text.slice(0,200)}`);
    // Basic check it didn't return login redirect
    if (text.includes('login.microsoftonline.com') || text.includes('Redirecting to login')) {
      throw new Error('Snapshot returned login page - cookie/token invalid or expired');
    }
    snapshotHtml = text;
    snapshotTime = Date.now();
    snapshotError = null;
    console.log(`[${new Date().toISOString()}] Snapshot updated ${text.length} bytes`);
  } catch (e) {
    snapshotError = e.message;
    console.error(`[${new Date().toISOString()}] Snapshot failed:`, e.message);
  }
}

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  toProxy: false,
});

proxy.on('proxyReq', async (proxyReq, req, res, options) => {
  // Inject Bearer token OR Cookie for apps.rmhedge.com requests (so TV's XHR + WS also auth)
  const target = options.target || '';
  if (typeof target === 'string' && target.includes('apps.rmhedge.com')) {
    try {
      if (SNAPSHOT_COOKIE) {
        proxyReq.setHeader('Cookie', SNAPSHOT_COOKIE);
      } else {
        const token = await getToken();
        if (token) proxyReq.setHeader('Authorization', `Bearer ${token}`);
      }
    } catch (e) {
      console.error(`[${new Date().toISOString()}] Token inject failed:`, e.message);
    }
  }
});

proxy.on('proxyRes', (proxyRes, req, res) => {
  proxyRes.headers['cross-origin-opener-policy'] = COOP;
  proxyRes.headers['cross-origin-embedder-policy'] = COEP;
  proxyRes.headers['access-control-allow-origin'] = '*';
});

proxy.on('error', (err, req, res) => {
  console.error(`[${new Date().toISOString()}] Proxy error:`, err.message);
  if (res && res.writeHead) {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Proxy error: ' + err.message);
  }
});

const server = http.createServer(async (req, res) => {
  // Simple TV page without WASM - fetches indexes data directly
  if (req.url === '/indexes-simple.html' || req.url === '/indexes-simple') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=0.52"><title>Indexes TV</title><style>body{background:#0a0a0a;color:#eee;font-family:Manrope, sans-serif;margin:0;padding:20px}h1{color:#196DF7}table{width:100%;border-collapse:collapse}th,td{padding:8px;border:1px solid #333;text-align:left}th{background:#196DF7;color:white}tr:nth-child(even){background:#1a1a1a}#status{color:#888}</style></head><body><h1>Indexes Report</h1><div id="status">Loading...</div><table id="tbl"><thead><tr><th>Index</th><th>Price</th><th>Change</th></tr></thead><tbody></tbody></table><script>
async function load(){
  const status=document.getElementById('status');
  try{
    status.textContent='Fetching indexes_report...';
    let r=await fetch('/indexes_report',{method:'POST',headers:{'Content-Type':'application/json'}});
    if(!r.ok) throw new Error('indexes_report '+r.status);
    let j=await r.json().catch(()=>r.text());
    console.log('indexes_report', j);
    status.textContent='Fetching stock_prices...';
    let r2=await fetch('/indexes_stock_prices',{method:'POST',headers:{'Content-Type':'application/json'}});
    if(!r2.ok) throw new Error('stock_prices '+r2.status);
    let j2=await r2.json().catch(()=>r2.text());
    console.log('stock_prices', j2);
    status.textContent='Loaded at '+new Date().toLocaleString();
    // Try to render - assume j is array or object
    let data = Array.isArray(j) ? j : (j.data || j.rows || [j]);
    let tbody=document.querySelector('#tbl tbody');
    tbody.innerHTML='';
    (Array.isArray(data)?data:[data]).slice(0,20).forEach(row=>{
      let tr=document.createElement('tr');
      let cols = typeof row==='object' ? Object.values(row).slice(0,3) : [row];
      cols.forEach(c=>{ let td=document.createElement('td'); td.textContent=String(c).slice(0,50); tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    if(!tbody.children.length) status.textContent='No rows - check console. Raw: '+JSON.stringify(j).slice(0,200);
  } catch(e){ status.textContent='Error: '+e.message; console.error(e); }
}
load();
setInterval(load, 60000);
</script></body></html>`);
    return;
  }
  // Snapshot endpoints - TV loads these with no auth
  if (req.url === '/snapshot' || req.url === '/snapshot/stick_05' || req.url === '/snapshot/indexes') {
    if (!snapshotHtml) await fetchSnapshot();
    if (snapshotHtml) {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'cross-origin-opener-policy': COOP,
        'cross-origin-embedder-policy': COEP,
        'Cache-Control': 'no-cache',
        'X-Snapshot-Time': new Date(snapshotTime).toISOString(),
      });
      // Inject viewport fix + SharedArrayBuffer fallback + fetch logging + hash for whole page
      // Whole page hash: #chart=false&dark=true&header=true&impacts=true&news=false&ticker=true
      if(!snapshotHtml.includes('chart=false')){
        snapshotHtml = snapshotHtml.replace('</head>', `<script>if(!window.location.hash) window.location.hash = "#chart=false&dark=true&header=true&impacts=true&news=false&ticker=true";</script></head>`);
      }
      let injected = snapshotHtml.replace('</head>', `<meta name="viewport" content="width=device-width, initial-scale=0.52"><script>
(function(){
  // Force WASM to not use SharedArrayBuffer when not crossOriginIsolated
  if(!window.crossOriginIsolated){
    console.log('Disabling SharedArrayBuffer - not crossOriginIsolated, forcing fallback');
    try { window.SharedArrayBuffer = undefined; } catch(e){}
    try { globalThis.SharedArrayBuffer = undefined; } catch(e){}
  }
  const origPost = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function(msg, transfer){
    try { return origPost.call(this, msg, transfer); }
    catch(e){
      const isSABError = e.message && (e.message.includes('SharedArrayBuffer') || e.message.includes('instanceof'));
      if(isSABError){
        console.log('Worker postMessage fallback without SAB', e.message);
        try {
          let cleanMsg = msg;
          if(msg && typeof msg === 'object'){
            cleanMsg = JSON.parse(JSON.stringify(msg, (k,v) => {
              try { return (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer) ? undefined : v; } catch(_) { return undefined; }
            }));
          }
          return origPost.call(this, cleanMsg);
        } catch(e2){ console.log('Fallback also failed', e2.message); throw e2; }
      }
      throw e;
    }
  };
  const origFetch = window.fetch;
  window.fetch = async function(...args){
    let url = args[0] instanceof Request ? args[0].url : args[0];
    // Rewrite absolute apps.rmhedge.com fetches to go via proxy so Cookie is injected
    let fetchArgs = args;
    try {
      if(typeof url === 'string' && url.includes('apps.rmhedge.com')){
        const u = new URL(url);
        const proxied = 'http://192.168.1.237:8080' + u.pathname + u.search + u.hash;
        console.log('FETCH REWRITE ' + url + ' -> ' + proxied);
        window.ReactNativeWebView.postMessage(JSON.stringify({type:'Console', data:{level:'info', message: 'FETCH REWRITE ' + url + ' -> ' + proxied}}));
        if(args[0] instanceof Request){
          fetchArgs = [new Request(proxied, args[0]), ...args.slice(1)];
        } else {
          fetchArgs = [proxied, ...args.slice(1)];
        }
        url = proxied;
      }
      const msg = 'FETCH ' + url;
      console.log(msg);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'Console', data:{level:'info', message: msg}}));
      const r = await origFetch(...fetchArgs);
      const okMsg = 'FETCH OK ' + url + ' ' + r.status;
      console.log(okMsg);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'Console', data:{level:'info', message: okMsg}}));
      return r;
    } catch(e){
      const failMsg = 'FETCH FAIL ' + (url || args[0]) + ' ' + e.message;
      console.log(failMsg);
      window.ReactNativeWebView.postMessage(JSON.stringify({type:'Console', data:{level:'error', message: failMsg}}));
      throw e;
    }
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m,u){ this._url = u; return origOpen.apply(this, arguments); };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function(){ this.addEventListener('load', () => console.log('XHR LOAD', this._url, this.status)); this.addEventListener('error', () => console.log('XHR ERROR', this._url)); return origSend.apply(this, arguments); };
})();
</script></head>`);
      res.end(injected);
    } else {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Snapshot not ready: ${snapshotError || 'fetching...'}`);
    }
    return;
  }
  if (req.url === '/snapshot/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ hasSnapshot: !!snapshotHtml, snapshotTime: snapshotTime ? new Date(snapshotTime).toISOString() : null, error: snapshotError, url: SNAPSHOT_URL }, null, 2));
    return;
  }
  if (req.url === '/snapshot/refresh' && req.method === 'POST') {
    await fetchSnapshot();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: !!snapshotHtml, error: snapshotError }));
    return;
  }

  // Handle snapshot asset/API proxy - TV loads /snapshot then fetches /static/*, /api/*, /indexes_* from same proxy host
  if (!TARGET_HOST && !req.headers['x-target-url'] && (req.url.startsWith('/static/') || req.url.startsWith('/images/') || req.url.startsWith('/manifest') || req.url.startsWith('/sw.js') || req.url.startsWith('/api/') || req.url.startsWith('/.auth/') || req.url.startsWith('/indexes_'))) {
    // Inject auth for indexes_report which needs Bearer + Cookie + correct Origin/Referer
    const BEARER = process.env.INDEXES_BEARER || 'eyJhdXRoX3R5cCI6ImFhZCIsImNsYWltcyI6W3sidHlwIjoiYXVkIiwidmFsIjoiOTBhNzZkNjYtNGE4NC00ZDM2LWJhNjktMjA1Njc3YzhlODRhIn0seyJ0eXAiOiJpc3MiLCJ2YWwiOiJodHRwczpcL1wvbG9naW4ubWljcm9zb2Z0b25saW5lLmNvbVwvNDZkNWRiNDgtODczNS00YTRkLTkyNjAtNWZmNGMxYWY2NTAxXC92Mi4wIn0seyJ0eXAiOiJpYXQiLCJ2YWwiOiIxNzg4NDE0NjI0In0seyJ0eXAiOiJuYmYiLCJ2YWwiOiIxNzg4NDE0NjI0In0seyJ0eXAiOiJleHAiLCJ2YWwiOiIxNzg4NDE4NTI0In0seyJ0eXAiOiJhaW8iLCJ2YWwiOiJBUVFCK1wvNGVBQUFBUHBuY2ZDYktWcVRuaFdYY0Zab1BmUVJWbWJYZkZDekR6STRVZ2xcLzdtV1JvNTFMQVwvck1QeUhwZHpJS29Ud2N6Mk1kVXVYSjJrWHRBOE4zMFZKeE5Dc2pLMXMrZDJlTkx2Mm1KYnhobVlST1l1MFo5c3NtQVBNV2w1bGF5WWxIZXBFdVFUTnlleGx1VVNZWGhwZllmbGVhdUJsbDJUWHkxdkg1ZXNrWWtPVXlkdm1xZFJjNUZVanZKNDFYQkdFcVNZUGNCTTJ4WUg0R1lkZEFIb3B0eFMzaXlMSFZpN3NhRUtmZWVOdUJKeVwvS0RyeU82cnVGT0sxSVhrSXg0dGMyaGVkWHhNYUxobFB0dnQ4ejRBblp6bnBQQm0rWU9EcHRhUUNIUXo1RDRtODNsa2h5V0Y2N2U0dHhVNkpYQW01WHJ5RE1sRW9PMXhkZVlVbDVUb2hYZ1BBPT0ifSx7InR5cCI6ImNfaGFzaCIsInZhbCI6Ims1RVFWdktCUTZDQndjNndVa1o1VXcifSx7InR5cCI6ImNjIiwidmFsIjoiQ2dFQUVndHliV2hsWkdkbExtTnZiUm9TQ2hET011dkpEUHozUnBCZmNWSzFZQUdzSWhJS0VBUDRVeXJCb3V4S3ZOZDlSQmlXQ2dBeUFrOURPQUE9In0seyJ0eXAiOiJodHRwOlwvXC9zY2hlbWFzLnhtbHNvYXAub3JnXC93c1wvMjAwNVwvMDVcL2lkZW50aXR5XC9jbGFpbXNcL2VtYWlsYWRkcmVzcyIsInZhbCI6ImpvbnR5Lmxlc2xpZUBybWhlZGdlLmNvbSJ9LHsidHlwIjoibmFtZSIsInZhbCI6IkpvbnR5IExlc2xpZSJ9LHsidHlwIjoibm9uY2UiLCJ2YWwiOiIwODBmOWZjNmEzMjY0OWFmYmQzMDMyNzNlMGQ4MjFhY18yMDI2MDkwMzA2MDAyNCJ9LHsidHlwIjoiaHR0cDpcL1wvc2NoZW1hcy5taWNyb3NvZnQuY29tXC9pZGVudGl0eVwvY2xhaW1zXC9vYmplY3RpZGVudGlmaWVyIiwidmFsIjoiNGNkNmRkYTctMGQ0Yi00OWFlLWJmYjAtZGI0MTQ5NmU4YmYzIn0seyJ0eXAiOiJwcmVmZXJyZWRfdXNlcm5hbWUiLCJ2YWwiOiJqb250eS5sZXNsaWVAcm1oZWRnZS5jb20ifSx7InR5cCI6InJoIiwidmFsIjoiMS5BVUVBU052VlJqV0hUVXFTWUZfMHdhOWxBV1p0cDVDRVNqWk51bWtnVm5mSTZFb0FBSEJCQUEuIn0seyJ0eXAiOiJzaWQiLCJ2YWwiOiIwMDg5ZDE1YS05MWE3LTRkNGQtYmQzMy1hOWZmZTI0ZWMzNDEifSx7InR5cCI6Imh0dHA6XC9cL3NjaGVtYXMueG1sc29hcC5vcmdcL3dzXC8yMDA1XC8wNVwvaWRlbnRpdHlcL2NsYWltc1wvbmFtZWlkZW50aWZpZXIiLCJ2YWwiOiJWQlV2aHNnSXZPakc4NkxCU3ZEWnlITFNYdGMzZmJ0UURDS1Vsb2ZEMXVvIn0seyJ0eXAiOiJodHRwOlwvXC9zY2hlbWFzLm1pY3Jvc29mdC5jb21cL2lkZW50aXR5XC9jbGFpbXNcL3RlbmFudGlkIiwidmFsIjoiNDZkNWRiNDgtODczNS00YTRkLTkyNjAtNWZmNGMxYWY2NTAxIn0seyJ0eXAiOiJ1dGkiLCJ2YWwiOiJBX2hUS3NHaTdFcTgxMzFFR0pZS0FBIn0seyJ0eXAiOiJ2ZXIiLCJ2YWwiOiIyLjAifV0sIm5hbWVfdHlwIjoiaHR0cDpcL1wvc2NoZW1hcy54bWxzb2FwLm9yZ1wvd3NcLzIwMDVcLzA1XC9pZGVudGl0eVwvY2xhaW1zXC9lbWFpbGFkZHJlc3MiLCJyb2xlX3R5cCI6Imh0dHA6XC9cL3NjaGVtYXMubWljcm9zb2Z0LmNvbVwvd3NcLzIwMDhcLzA2XC9pZGVudGl0eVwvY2xhaW1zXC9yb2xlIn0=';
    if(!req.headers['authorization'] && BEARER) req.headers['authorization'] = 'Bearer ' + BEARER;
    // Fix CSRF - server checks Referer/Origin
    req.headers['referer'] = 'https://apps.rmhedge.com/';
    req.headers['origin'] = 'https://apps.rmhedge.com';
    req.headers['accept'] = req.headers['accept'] || '*/*';
    const targetHost = 'https://apps.rmhedge.com';
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} -> ${targetHost}${req.url} (asset/API proxy)`);
    if (SNAPSHOT_COOKIE && !req.headers['cookie']) req.headers['cookie'] = SNAPSHOT_COOKIE;
    // Strip query hash fragment already removed by browser, just proxy path
    proxy.web(req, res, { target: targetHost });
    return;
  }

  const target = TARGET_HOST || req.headers['x-target-url'];

  if (!TARGET_HOST && !target) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Set TARGET_HOST env var or X-Target-Url header');
    return;
  }

  if (target) {
    delete req.headers['x-target-url'];
  }

  const targetHost = TARGET_HOST || target;
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} -> ${targetHost}`);

  // Pre-fetch token/cookie so proxyReq has it (http-proxy is async-unsafe, so inject via header on original req too)
  if (targetHost.includes('apps.rmhedge.com')) {
    if (SNAPSHOT_COOKIE && !req.headers['cookie']) {
      req.headers['cookie'] = SNAPSHOT_COOKIE;
    } else if (CLIENT_SECRET && !req.headers['authorization']) {
      try {
        const token = await getToken();
        if (token) req.headers['authorization'] = `Bearer ${token}`;
      } catch (e) {
        console.error(`[${new Date().toISOString()}] Pre-token failed:`, e.message);
      }
    }
  }

  proxy.web(req, res, { target: targetHost });
});

server.on('upgrade', (req, clientReq, head) => {
  const target = TARGET_HOST || clientReq.headers['x-target-url'];
  if (target) {
    delete clientReq.headers['x-target-url'];
    proxy.ws(req, clientReq, head, { target });
  }
});

server.listen(PROXY_PORT, () => {
  console.log(`Proxy running on port ${PROXY_PORT}`);
  if (TARGET_HOST) {
    console.log(`Forwarding all requests to ${TARGET_HOST}`);
  } else {
    console.log('Use X-Target-Url header to specify destination per-request');
  }
  console.log(`Snapshot cron: ${SNAPSHOT_URL} every ${SNAPSHOT_INTERVAL_MS}ms -> http://localhost:${PROXY_PORT}/snapshot/stick_05`);
  fetchSnapshot();
  setInterval(fetchSnapshot, SNAPSHOT_INTERVAL_MS);
});

process.on('uncaughtException', (e) => console.error('Uncaught:', e));