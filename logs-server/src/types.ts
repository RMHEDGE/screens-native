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

export interface SubscribeCommand {
    type: 'subscribe' | 'unsubscribe';
    projectId: string;
}
