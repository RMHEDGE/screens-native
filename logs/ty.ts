export interface LogEntryData {
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    data?: Record<string, any>;
}

export interface LogEntry extends LogEntryData {
    id: string;
    timestamp: string;
    projectId: string;
    loggerId: string;
}

export interface GetLogsOptions {
    hours?: number;
    offset?: number;
    limit?: number;
    projectId?: string;
}

export interface GetLogsResponse {
    count: number;
    data: LogEntry[];
}

export interface WebSocketLogMessage {
    type: 'log';
    data: LogEntry;
}

export interface WebSocketControlMessage {
    type: 'subscribed' | 'unsubscribed' | 'connected' | 'error';
    projectId?: string;
    message: string;
}

export type WebSocketMessage = WebSocketLogMessage | WebSocketControlMessage;