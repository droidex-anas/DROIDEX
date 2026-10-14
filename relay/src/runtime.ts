// The relay uses only this small Workers API surface and has no runtime dependencies.
export interface RelaySocket {
  readyState: number;
  send(message: string): void;
  close(code?: number, reason?: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

export interface ObjectState {
  storage: {
    get<T>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    getAlarm(): Promise<number | null>;
    setAlarm(time: number): Promise<void>;
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  getWebSockets(): RelaySocket[];
  acceptWebSocket(socket: RelaySocket): void;
  setWebSocketAutoResponse(pair: { getRequest(): string; getResponse(): string }): void;
}

export interface Environment {
  ROOMS: {
    idFromName(name: string): unknown;
    get(id: unknown): { fetch(request: Request): Promise<Response> };
  };
  CONNECTION_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
  WEB_ORIGIN: string;
}

declare global {
  class WebSocketPair {
    0: RelaySocket;
    1: RelaySocket;
  }
  const WebSocketRequestResponsePair: new (
    request: string,
    response: string,
  ) => {
    getRequest(): string;
    getResponse(): string;
  };
}
