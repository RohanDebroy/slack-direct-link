export interface Session {
  evaluate<T>(expression: string): Promise<T>;
  on(event: "Network.webSocketFrameReceived", handler: (params: WssFrame) => void): () => void;
  close(): Promise<void>;
}

export interface WssFrame {
  requestId: string;
  timestamp: number;
  response: {
    payloadData: string;
    opcode: number;
    mask: boolean;
  };
}

export interface ConnectOptions {
  port: number;
  /** URL substring used to find the right target. Default: "app.slack.com". */
  urlMatch?: string;
}
