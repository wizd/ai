import WebSocket from 'ws';
import { JSONRPCMessage, JSONRPCMessageSchema } from './json-rpc-message';
import { MCPTransport } from './mcp-transport';

// 最大重试次数
const MAX_RETRIES = 3;
// 重试延迟（毫秒）
const RETRY_DELAY_MS = 1000;

// WebSocket错误事件类型
interface WebSocketErrorEvent {
  error: Error;
}

// WebSocket消息事件类型
interface WebSocketMessageEvent {
  data: string | Buffer | ArrayBuffer | Buffer[];
}

// 延迟辅助函数
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export class WebSocketMCPTransport implements MCPTransport {
  private socket?: WebSocket;
  private url: URL;
  private connected = false;
  private abortController: AbortController = new AbortController();
  private headers?: Record<string, string>;

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor({
    url,
    headers,
  }: {
    url: string;
    headers?: Record<string, string>;
  }) {
    // 将 HTTP/HTTPS URL 转换为 WS/WSS URL
    this.url = new URL(url.replace(/^http/i, 'ws'));
    this.headers = headers;
  }

  async start(): Promise<void> {
    if (this.connected) {
      return;
    }

    let attempts = 0;
    while (attempts < MAX_RETRIES) {
      try {
        await this._connect();
        this.connected = true;
        return;
      } catch (error) {
        attempts++;
        if (attempts === MAX_RETRIES) {
          throw error;
        }
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  private _connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.socket = new WebSocket(this.url.href, {
          headers: this.headers,
          signal: this.abortController.signal,
        });

        this.socket.onerror = (event: WebSocketErrorEvent) => {
          const error = new Error(`MCP WebSocket Transport Error: Connection error`);
          error.cause = event.error;
          this.onerror?.(error);
          reject(error);
        };

        this.socket.onopen = () => {
          resolve();
        };

        this.socket.onclose = () => {
          this.connected = false;
          this.onclose?.();
        };

        this.socket.onmessage = (event: WebSocketMessageEvent) => {
          try {
            let dataString: string;
            if (typeof event.data === 'string') {
              dataString = event.data;
            } else if (event.data instanceof Buffer) {
              dataString = event.data.toString('utf-8');
            } else if (event.data instanceof ArrayBuffer) {
              dataString = Buffer.from(event.data).toString('utf-8');
            } else {
              throw new Error('MCP WebSocket Transport Error: Unsupported data type');
            }

            const message = JSONRPCMessageSchema.parse(JSON.parse(dataString));
            this.onmessage?.(message);
          } catch (parseError) {
            const error = new Error('MCP WebSocket Transport Error: Failed to parse message');
            error.cause = parseError;
            this.onerror?.(error);
            // 我们不抛出异常，以便在报告错误后继续处理消息
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  async close(): Promise<void> {
    this.connected = false;
    this.abortController.abort();
    
    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close();
      }
      this.socket = undefined;
    }
    
    this.onclose?.();
    return Promise.resolve();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.socket || !this.connected) {
      throw new Error('MCP WebSocket Transport Error: Not connected');
    }

    let attempts = 0;
    while (attempts < MAX_RETRIES) {
      try {
        if (this.socket.readyState !== WebSocket.OPEN) {
          throw new Error('MCP WebSocket Transport Error: Socket not in OPEN state');
        }

        await new Promise<void>((resolve, reject) => {
          try {
            this.socket!.send(JSON.stringify(message), (error: Error | undefined) => {
              if (error) {
                const sendError = new Error('MCP WebSocket Transport Error: Failed to send message');
                sendError.cause = error;
                reject(sendError);
              } else {
                resolve();
              }
            });
          } catch (error) {
            const sendError = new Error('MCP WebSocket Transport Error: Failed to send message');
            sendError.cause = error;
            reject(sendError);
          }
        });
        
        return;
      } catch (error) {
        attempts++;
        if (attempts === MAX_RETRIES) {
          if (error instanceof Error) {
            this.onerror?.(error);
          } else {
            this.onerror?.(new Error(String(error)));
          }
          throw error;
        }
        await delay(RETRY_DELAY_MS);
      }
    }
  }
} 