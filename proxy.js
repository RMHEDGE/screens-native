const http = require('http');
const httpProxy = require('http-proxy');

const PROXY_PORT = process.env.PORT || 8080;
const TARGET_HOST = process.env.TARGET_HOST;

const COOP = 'same-origin';
const COEP = 'require-corp';

const proxy = httpProxy.createProxyServer({
  changeOrigin: true,
  toProxy: false,
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

const server = http.createServer((req, res) => {
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
});

process.on('uncaughtException', (e) => console.error('Uncaught:', e));