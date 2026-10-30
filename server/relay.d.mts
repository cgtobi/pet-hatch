import type { Server } from 'node:http';

export interface Relay {
  server: Server;
  rooms: Map<string, unknown>;
  /** Start listening; resolves with the actual port (pass 0 for a random free one). */
  listen(port?: number, host?: string): Promise<number>;
  close(): Promise<void>;
}

export function createRelay(options?: {
  staticDir?: string | null;
  log?: (msg: string) => void;
  /** Open connections per visitor (IP address, IPv6 by /64); 0 turns the limit off. */
  maxPerVisitor?: number;
  /** How long two pets wait before an uneven offer (tests use less). */
  offerAfterMs?: number;
}): Relay;

/** The visitor an address counts as: the IP itself, or an IPv6 address's /64 network. */
export function visitorOf(address?: string): string;

/** Whether a player's message pretends to come from the relay (and so must not be forwarded). */
export function speaksForRelay(text: string): boolean;
