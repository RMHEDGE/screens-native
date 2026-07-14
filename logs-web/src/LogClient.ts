import { LogEntry, LogEntryData, GetLogsOptions, GetLogsResponse, WebSocketMessage } from './ty';
export interface LogClientOptions {
    baseURL: string;
    timeout?: number;
}

export class LogClient {
    private baseURL: URL;
    private timeout: number;

    constructor(options: LogClientOptions) {
        this.baseURL = new URL(options.baseURL);
        this.timeout = options.timeout || 5000;
    }

    private async request<T>(method: string, path: string, body?: any): Promise<T> {
        const url = new URL(path, this.baseURL);

        const headers: HeadersInit = {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const fetchOptions: RequestInit = {
                method: method,
                headers: headers,
                signal: controller.signal,
            };

            if (body) {
                fetchOptions.body = JSON.stringify(body);
            }

            const response = await fetch(url.toString(), fetchOptions);
            clearTimeout(timeoutId);

            if (response.ok) {
                const text = await response.text();
                return text ? JSON.parse(text) : ({} as T);
            } else {
                let errorMsg = `Request failed with status code ${response.status}`;
                try {
                    const errorData = await response.json();
                    errorMsg += `: ${errorData.error || errorData.message || JSON.stringify(errorData)}`;
                } catch (e) {
                    const rawText = await response.text();
                    errorMsg += `: ${rawText}`;
                }
                throw new Error(errorMsg);
            }
        } catch (error: any) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Request timed out after ${this.timeout}ms`);
            }
            throw new Error(`Network error or failed request: ${error.message}`);
        }
    }

    async registerLogger(loggerId: string): Promise<{ message: string }> {
        if (!loggerId) throw new Error("Logger ID is required.");
        return this.request<{ message: string }>('POST', `/register/${loggerId}`);
    }

    async unregisterLogger(loggerId: string): Promise<{ message: string }> {
        if (!loggerId) throw new Error("Logger ID is required.");
        return this.request<{ message: string }>('POST', `/unregister/${loggerId}`);
    }

    async sendLog(
        loggerId: string,
        projectId: string,
        logData: LogEntryData
    ): Promise<{ id: string; message: string }> {
        if (!loggerId) throw new Error("Logger ID is required.");
        if (!projectId) throw new Error("Project ID is required.");
        if (!logData || !logData.level || !logData.message) {
            throw new Error("Log level and message are required.");
        }
        return this.request<{ id: string; message: string }>(
            'POST',
            `/log/${loggerId}/${projectId}`,
            logData
        );
    }

    async getLogs(options?: GetLogsOptions): Promise<GetLogsResponse> {
        const queryParams = new URLSearchParams();
        if (options?.hours !== undefined) queryParams.append('hours', options.hours.toString());
        if (options?.offset !== undefined) queryParams.append('offset', options.offset.toString());
        if (options?.limit !== undefined) queryParams.append('limit', options.limit.toString());
        if (options?.projectId) queryParams.append('projectId', options.projectId);

        const path = `/api/logs${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
        return this.request<GetLogsResponse>('GET', path);
    }

    /**
     * Connects to the live log stream via WebSocket.
     * @param projectIds - A string or array of strings for project IDs to subscribe to. Use '*' for all.
     * @param onLog - Callback function when a new log entry is received.
     * @param onOpen - Optional callback when the WebSocket connection is opened and subscriptions are attempted.
     * @param onError - Optional callback for WebSocket errors.
     * @param onClose - Optional callback for WebSocket close events.
     * @returns A WebSocket instance that can be used to close the connection or send further commands.
     */
    connectToLiveLogs({
        projectIds,
        onLog,
        onOpen,
        onError,
        onClose
    }: {
        projectIds: string | string[];
        onLog: (logEntry: LogEntry) => void;
        onOpen?: (subscribedTo: string[]) => void;
        onError?: (error: Error) => void;
        onClose?: (event: { code: number; reason: string }) => void;
    }): WebSocket {
        const wsProtocol = this.baseURL.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${this.baseURL.host}/ws`;
        const ws = new WebSocket(wsUrl);
        const projectsToSubscribe = Array.isArray(projectIds) ? projectIds : [projectIds];

        ws.onopen = () => {
            console.log(`LogClient: WebSocket connection opened to ${wsUrl}`);
            projectsToSubscribe.forEach(projectId => {
                ws.send(JSON.stringify({ type: 'subscribe', projectId }));
            });
        };

        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data.toString()) as WebSocketMessage;
                if (message.type === 'log' && message.data) {
                    onLog(message.data);
                } else if (message.type === 'subscribed') {
                    console.log(`LogClient: Subscribed to project ${message.projectId}`);
                } else if (message.type === 'unsubscribed') {
                    console.log(`LogClient: Unsubscribed from project ${message.projectId}`);
                } else if (message.type === 'connected') {
                    console.log(`LogClient: WebSocket server message: ${message.message}`);
                } else if (message.type === 'error') {
                    console.error(`LogClient: WebSocket server error: ${message.message}`);
                    if (onError) onError(new Error(`Server WebSocket error: ${message.message}`));
                }
            } catch (e: any) {
                console.error('LogClient: Error processing WebSocket message:', e);
                if (onError) onError(e);
            }
        };

        ws.onerror = (error) => {
            console.error('LogClient: WebSocket error:', error);
            if (onError) onError(new Error('WebSocket error occurred'));
        };

        ws.onclose = (event) => {
            console.log(`LogClient: WebSocket connection closed. Code: ${event.code}, Reason: ${event.reason}`);
            if (onClose) onClose({ code: event.code, reason: event.reason });
        };

        return ws;
    }

    /**
     * In React Native, there's no equivalent to destroying http/https agents for fetch.
     * This method can be kept as a no-op or removed.
     */
    destroy(): void {
        console.log("LogClient: destroy() called. No agents to destroy in React Native.");
    }
}