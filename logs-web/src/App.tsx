import { useEffect, useMemo, useRef, useState } from 'react';
import { LogClient } from './LogClient';
import type { LogEntry, LogEntryData } from './ty';

type ConnStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

const DEFAULT_BASE_URL = 'http://localhost:4001';

function formatTime(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function LogLine({ entry }: { entry: LogEntry }) {
    return (
        <div className="log-line">
            <span className="log-time">{formatTime(entry.timestamp)}</span>
            <span className={`log-level ${entry.level}`}>{entry.level}</span>
            <span className="log-project" title={`${entry.loggerId} → ${entry.projectId}`}>
                {entry.projectId}
            </span>
            <span className="log-message">
                {entry.message}
                {entry.data && Object.keys(entry.data).length > 0 && (
                    <span className="log-data"> {JSON.stringify(entry.data)}</span>
                )}
            </span>
        </div>
    );
}

export default function App() {
    const [baseURLInput, setBaseURLInput] = useState(DEFAULT_BASE_URL);
    const [baseURL, setBaseURL] = useState(DEFAULT_BASE_URL);

    const [loggerId, setLoggerId] = useState('demo-logger');
    const [registered, setRegistered] = useState(false);
    const [statusMsg, setStatusMsg] = useState<string | null>(null);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [projectFilter, setProjectFilter] = useState('*');
    const [connStatus, setConnStatus] = useState<ConnStatus>('idle');

    const [sendProjectId, setSendProjectId] = useState('demo-project');
    const [sendLevel, setSendLevel] = useState<LogEntryData['level']>('info');
    const [sendMessage, setSendMessage] = useState('');

    const [logs, setLogs] = useState<LogEntry[]>([]);

    const wsRef = useRef<WebSocket | null>(null);
    const streamRef = useRef<HTMLDivElement | null>(null);

    const client = useMemo(() => new LogClient({ baseURL }), [baseURL]);

    useEffect(() => {
        return () => {
            wsRef.current?.close();
        };
    }, []);

    useEffect(() => {
        const el = streamRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [logs]);

    async function handleApplyBaseURL() {
        wsRef.current?.close();
        setConnStatus('idle');
        setRegistered(false);
        setBaseURL(baseURLInput.trim() || DEFAULT_BASE_URL);
    }

    async function handleRegister() {
        setErrorMsg(null);
        try {
            const res = await client.registerLogger(loggerId);
            setRegistered(true);
            setStatusMsg(res.message);
        } catch (e: any) {
            setErrorMsg(e.message);
        }
    }

    async function handleUnregister() {
        setErrorMsg(null);
        try {
            const res = await client.unregisterLogger(loggerId);
            setRegistered(false);
            setStatusMsg(res.message);
        } catch (e: any) {
            setErrorMsg(e.message);
        }
    }

    async function handleLoadHistory() {
        setErrorMsg(null);
        try {
            const res = await client.getLogs({
                projectId: projectFilter !== '*' ? projectFilter : undefined,
                limit: 200,
            });
            setLogs([...res.data].reverse());
        } catch (e: any) {
            setErrorMsg(e.message);
        }
    }

    function handleConnect() {
        setErrorMsg(null);
        wsRef.current?.close();
        setConnStatus('connecting');

        const projectIds = projectFilter
            .split(',')
            .map((p) => p.trim())
            .filter(Boolean);

        const ws = client.connectToLiveLogs({
            projectIds: projectIds.length > 0 ? projectIds : '*',
            onLog: (entry) => setLogs((prev) => [...prev, entry]),
            onOpen: () => setConnStatus('open'),
            onError: (err) => {
                setConnStatus('error');
                setErrorMsg(err.message);
            },
            onClose: () => setConnStatus('closed'),
        });

        wsRef.current = ws;
    }

    function handleDisconnect() {
        wsRef.current?.close();
        setConnStatus('closed');
    }

    async function handleSendTestLog(e: React.FormEvent) {
        e.preventDefault();
        setErrorMsg(null);
        if (!sendMessage.trim()) return;
        try {
            await client.sendLog(loggerId, sendProjectId, { level: sendLevel, message: sendMessage });
            setSendMessage('');
        } catch (e: any) {
            setErrorMsg(e.message);
        }
    }

    const dotClass =
        connStatus === 'open' ? 'open' : connStatus === 'connecting' ? 'connecting' : connStatus === 'error' ? 'error' : '';

    return (
        <div className="app">
            <header className="brand">
                <span className={`brand-mark ${dotClass}`} />
                <span className="brand-title">
                    logstream <span className="dim">/ open logging server</span>
                </span>
                <span className="brand-status">
                    {connStatus === 'open' && 'streaming live'}
                    {connStatus === 'connecting' && 'connecting…'}
                    {connStatus === 'closed' && 'disconnected'}
                    {connStatus === 'error' && 'connection error'}
                    {connStatus === 'idle' && 'not connected'}
                </span>
            </header>

            <aside className="sidebar">
                <div className="section">
                    <div className="section-label">Server</div>
                    <div className="field">
                        <label htmlFor="baseurl">Base URL</label>
                        <input
                            id="baseurl"
                            type="text"
                            value={baseURLInput}
                            onChange={(e) => setBaseURLInput(e.target.value)}
                            onBlur={handleApplyBaseURL}
                            onKeyDown={(e) => e.key === 'Enter' && handleApplyBaseURL()}
                        />
                    </div>
                </div>

                <div className="section">
                    <div className="section-label">
                        Logger identity <span className={`badge ${registered ? 'on' : ''}`}>{registered ? 'registered' : 'unregistered'}</span>
                    </div>
                    <div className="field">
                        <label htmlFor="loggerId">Logger ID</label>
                        <input id="loggerId" type="text" value={loggerId} onChange={(e) => setLoggerId(e.target.value)} />
                    </div>
                    <div className="btn-row">
                        <button className="primary full" onClick={handleRegister} disabled={!loggerId || registered}>
                            Register
                        </button>
                        <button className="danger" onClick={handleUnregister} disabled={!registered}>
                            Unregister
                        </button>
                    </div>
                </div>

                <div className="section">
                    <div className="section-label">Live stream</div>
                    <div className="field">
                        <label htmlFor="projectFilter">Project(s) — comma separated, or *</label>
                        <input
                            id="projectFilter"
                            type="text"
                            value={projectFilter}
                            onChange={(e) => setProjectFilter(e.target.value)}
                        />
                    </div>
                    <div className="btn-row">
                        {connStatus === 'open' || connStatus === 'connecting' ? (
                            <button className="full" onClick={handleDisconnect}>
                                Disconnect
                            </button>
                        ) : (
                            <button className="primary full" onClick={handleConnect}>
                                Connect
                            </button>
                        )}
                    </div>
                    <button className="full" onClick={handleLoadHistory}>
                        Load history
                    </button>
                </div>

                <div className="section">
                    <div className="section-label">Send test log</div>
                    <form className="section" onSubmit={handleSendTestLog}>
                        <div className="field">
                            <label htmlFor="sendProject">Project ID</label>
                            <input
                                id="sendProject"
                                type="text"
                                value={sendProjectId}
                                onChange={(e) => setSendProjectId(e.target.value)}
                            />
                        </div>
                        <div className="field">
                            <label htmlFor="sendLevel">Level</label>
                            <select id="sendLevel" value={sendLevel} onChange={(e) => setSendLevel(e.target.value as LogEntryData['level'])}>
                                <option value="debug">debug</option>
                                <option value="info">info</option>
                                <option value="warn">warn</option>
                                <option value="error">error</option>
                            </select>
                        </div>
                        <div className="field">
                            <label htmlFor="sendMessage">Message</label>
                            <textarea
                                id="sendMessage"
                                value={sendMessage}
                                onChange={(e) => setSendMessage(e.target.value)}
                                placeholder="something happened…"
                            />
                        </div>
                        <button className="primary full" type="submit" disabled={!registered || !sendMessage.trim()}>
                            Send
                        </button>
                        {!registered && <span className="hint">Register a logger ID above first.</span>}
                    </form>
                </div>

                {(statusMsg || errorMsg) && (
                    <div className="section">
                        {statusMsg && <span className="hint">{statusMsg}</span>}
                        {errorMsg && <span className="hint error-text">{errorMsg}</span>}
                    </div>
                )}
            </aside>

            <main className="main">
                <div className="stream-header">
                    <span className="filter-chip">{projectFilter || '*'}</span>
                    <span className="count">{logs.length} lines</span>
                    <span className="spacer" />
                    <button onClick={() => setLogs([])}>Clear</button>
                </div>
                <div className="stream" ref={streamRef}>
                    {logs.length === 0 ? (
                        <div className="empty-state">
                            <span className="big">⌁</span>
                            <span>No logs yet. Connect, then send or wait for a log line.</span>
                        </div>
                    ) : (
                        <>
                            {logs.map((entry) => (
                                <LogLine key={entry.id} entry={entry} />
                            ))}
                            {connStatus === 'open' && <span className="cursor" />}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
