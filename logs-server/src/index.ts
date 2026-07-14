import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import type { LogEntry, LogEntryData, SubscribeCommand } from './types.js';

const PORT = Number(process.env.PORT) || 4001;
const MAX_LOGS = 5000;

// ---- in-memory state -------------------------------------------------

const registeredLoggers = new Set<string>();
const logs: LogEntry[] = [];
const subscriptions = new Map<WebSocket, Set<string>>();

function broadcast(entry: LogEntry) {
    const payload = JSON.stringify({ type: 'log', data: entry });
    for (const [client, projectIds] of subscriptions) {
        if (client.readyState !== WebSocket.OPEN) continue;
        if (projectIds.has('*') || projectIds.has(entry.projectId)) {
            client.send(payload);
        }
    }
}

// ---- http app ----------------------------------------------------------

const app = express();
app.use(cors());
app.use(express.json());

app.post('/register/:loggerId', (req, res) => {
    const { loggerId } = req.params;
    registeredLoggers.add(loggerId);
    res.json({ message: `Logger '${loggerId}' registered.` });
});

app.post('/unregister/:loggerId', (req, res) => {
    const { loggerId } = req.params;
    registeredLoggers.delete(loggerId);
    res.json({ message: `Logger '${loggerId}' unregistered.` });
});

app.post('/log/:loggerId/:projectId', (req, res) => {
    const { loggerId, projectId } = req.params;
    const body = req.body as LogEntryData;

    if (!registeredLoggers.has(loggerId)) {
        res.status(403).json({ error: `Logger '${loggerId}' is not registered.` });
        return;
    }
    if (!body || !body.level || !body.message) {
        res.status(400).json({ error: 'Log level and message are required.' });
        return;
    }

    const entry: LogEntry = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        projectId,
        loggerId,
        level: body.level,
        message: body.message,
        data: body.data,
    };

    logs.push(entry);
    if (logs.length > MAX_LOGS) logs.splice(0, logs.length - MAX_LOGS);

    broadcast(entry);

    res.json({ id: entry.id, message: 'Log recorded.' });
});

app.get('/api/logs', (req, res) => {
    const hours = req.query.hours !== undefined ? Number(req.query.hours) : undefined;
    const offset = req.query.offset !== undefined ? Number(req.query.offset) : 0;
    const limit = req.query.limit !== undefined ? Number(req.query.limit) : 100;
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;

    let filtered = logs;
    if (hours !== undefined && !Number.isNaN(hours)) {
        const cutoff = Date.now() - hours * 60 * 60 * 1000;
        filtered = filtered.filter((l) => new Date(l.timestamp).getTime() >= cutoff);
    }
    if (projectId && projectId !== '*') {
        filtered = filtered.filter((l) => l.projectId === projectId);
    }

    // newest first
    const sorted = [...filtered].reverse();
    const page = sorted.slice(offset, offset + limit);

    res.json({ count: filtered.length, data: page });
});

app.get('/health', (_req, res) => {
    res.json({ ok: true, loggers: registeredLoggers.size, logs: logs.length });
});

// ---- ws server -----------------------------------------------------------

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (ws) => {
    subscriptions.set(ws, new Set());
    ws.send(JSON.stringify({ type: 'connected', message: 'Connected to logstream.' }));

    ws.on('message', (raw) => {
        try {
            const cmd = JSON.parse(raw.toString()) as SubscribeCommand;
            const subs = subscriptions.get(ws)!;
            if (cmd.type === 'subscribe') {
                subs.add(cmd.projectId);
                ws.send(JSON.stringify({ type: 'subscribed', projectId: cmd.projectId, message: 'Subscribed.' }));
            } else if (cmd.type === 'unsubscribe') {
                subs.delete(cmd.projectId);
                ws.send(JSON.stringify({ type: 'unsubscribed', projectId: cmd.projectId, message: 'Unsubscribed.' }));
            } else {
                ws.send(JSON.stringify({ type: 'error', message: `Unknown command type: ${(cmd as any).type}` }));
            }
        } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid message: expected JSON { type, projectId }.' }));
        }
    });

    ws.on('close', () => {
        subscriptions.delete(ws);
    });
});

httpServer.listen(PORT, () => {
    console.log(`logstream server listening on http://localhost:${PORT} (ws at /ws)`);
});
