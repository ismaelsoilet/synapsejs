/**
 * SynapseJS - Native Bidirectional WebSocket Abstraction
 *
 * Provides a type-safe contract for real-time duplex communication
 * seamlessly integrated with native Bun.serve WebSockets.
 */

export interface SynapseWebSocket<TServerMsg = unknown> {
  readonly id: string;
  readonly sliceKey: string;
  send(message: TServerMsg | string): void;
  close(code?: number, reason?: string): void;
  data: Record<string, unknown>;
}

export interface SliceSocketDefinition<TClientMsg = unknown, TServerMsg = unknown> {
  onOpen?: (ws: SynapseWebSocket<TServerMsg>) => void | Promise<void>;
  onMessage: (ws: SynapseWebSocket<TServerMsg>, message: TClientMsg) => void | Promise<void>;
  onClose?: (ws: SynapseWebSocket<TServerMsg>, code: number, reason: string) => void | Promise<void>;
}

/**
 * Declares a bidirectional WebSocket endpoint for a slice.
 * Automatically discovered and mounted at `GET /_synapse/ws/:domain/:name`.
 */
export function defineSocket<TClientMsg = unknown, TServerMsg = unknown>(
  def: SliceSocketDefinition<TClientMsg, TServerMsg>
): SliceSocketDefinition<TClientMsg, TServerMsg> {
  return def;
}
