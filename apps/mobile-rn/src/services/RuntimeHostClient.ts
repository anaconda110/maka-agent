/**
 * Runtime Host client adapter (placeholder).
 *
 * Real implementation will wrap `@maka/runtime-host/client` with a
 * `MobileFramedTransport` based on WebSocket instead of `node:net`.
 * See .hive/android-rn-architecture.md §4.2.
 */

export interface RuntimeHostEndpoint {
  url: string;
  token?: string;
}

export interface RuntimeHostClient {
  connect(endpoint: RuntimeHostEndpoint): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}

export function createRuntimeHostClient(): RuntimeHostClient {
  let connected = false;
  return {
    async connect(_endpoint: RuntimeHostEndpoint) {
      // TODO: implement WebSocket-based framed transport + handshake.
      connected = true;
    },
    async disconnect() {
      connected = false;
    },
    isConnected() {
      return connected;
    },
  };
}