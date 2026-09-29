/**
 * SynapseJS - Reactive Event Hub & Server-Sent Events (SSE) Engine
 *
 * Lightweight, in-memory pub/sub broker for reactive slice subscriptions.
 * Zero external dependencies, thread-safe within the Bun process, and designed
 * for real-time reactivity without stateful WebSocket overhead.
 */

export type EventListener = (data: unknown) => void;
export type UnsubscribeFn = () => void;

export class EventHub {
  private topics: Map<string, Set<EventListener>> = new Map();

  /**
   * Subscribes a listener to a specific topic.
   * Returns an unsubscribe function.
   */
  subscribe(topic: string, listener: EventListener): UnsubscribeFn {
    let listeners = this.topics.get(topic);
    if (!listeners) {
      listeners = new Set();
      this.topics.set(topic, listeners);
    }

    listeners.add(listener);

    return () => {
      listeners?.delete(listener);
      if (listeners && listeners.size === 0) {
        this.topics.delete(topic);
      }
    };
  }

  /**
   * Publishes an event payload to all listeners registered for the topic.
   * Returns the number of listeners that received the event.
   */
  publish(topic: string, data: unknown): number {
    const listeners = this.topics.get(topic);
    if (!listeners || listeners.size === 0) {
      return 0;
    }

    let notified = 0;
    for (const listener of listeners) {
      try {
        const result: unknown = listener(data);
        if (result && typeof (result as { catch?: unknown }).catch === 'function') {
          (result as { catch: (fn: (err: unknown) => void) => void }).catch((err: unknown) => {
            console.error(`[EventHub] Erro assíncrono no listener do tópico "${topic}":`, err);
          });
        }
        notified++;
      } catch (err) {
        console.error(`[EventHub] Erro no listener do tópico "${topic}":`, err);
      }
    }

    return notified;
  }

  /**
   * Returns the count of active listeners on a given topic.
   */
  listenerCount(topic: string): number {
    return this.topics.get(topic)?.size ?? 0;
  }

  /**
   * Returns all active topics currently subscribed to.
   */
  activeTopics(): string[] {
    return Array.from(this.topics.keys());
  }

  /**
   * Clears listeners for a given topic, or all topics if none specified.
   */
  clear(topic?: string): void {
    if (topic) {
      this.topics.delete(topic);
    } else {
      this.topics.clear();
    }
  }
}

let globalEventHub: EventHub | null = null;

export function getEventHub(): EventHub {
  if (!globalEventHub) {
    globalEventHub = new EventHub();
  }
  return globalEventHub;
}

export function resetEventHub(): void {
  globalEventHub?.clear();
  globalEventHub = null;
}
