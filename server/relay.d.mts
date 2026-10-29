import type { Server } from 'node:http';

export interface Relay {
  server: Server;
  rooms: Map<string, unknown>;
  /** Start listening; resolves with the actual port (pass 0 for a random free one). */
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createRelay(options?: { staticDir?: string | null; log?: (msg: string) => void }): Relay;
