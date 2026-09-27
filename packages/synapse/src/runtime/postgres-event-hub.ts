/**
 * SynapseJS - Distributed PostgreSQL EventHub
 *
 * Implements a distributed pub/sub broker across multiple server instances
 * using PostgreSQL LISTEN/NOTIFY with:
 * 1. Dedicated persistent connection for LISTEN (max: 1) to avoid transaction pooler starvation.
 * 2. Automatic payload chunking / offloading to `_synapse_event_payloads` for messages > 7.5KB (RFC 8KB pg_notify limit).
 * 3. Transparent local delivery and non-blocking background broadcast.
 */

import postgres from 'postgres';
import { EventHub } from './event-hub';

export interface PostgresEventHubOptions {
  connectionUri: string;
  channelName?: string;
  onNotice?: (notice: postgres.Notice) => void;
}

export class PostgresEventHub extends EventHub {
  public readonly instanceId = crypto.randomUUID();
  private connectionUri: string;
  private channelName: string;
  private listenerClient: postgres.Sql | null = null;
  private publisherClient: postgres.Sql | null = null;
  private isInitialized = false;
  private isClosed = false;

  constructor(options: PostgresEventHubOptions) {
    super();
    this.connectionUri = options.connectionUri;
    this.channelName = options.channelName || 'synapse_events';
  }

  /**
   * Initializes persistent dedicated connection for LISTEN and publisher pool.
   */
  async init(): Promise<void> {
    if (this.isInitialized || this.isClosed) return;

    // 1. Dedicated persistent listener connection (max: 1, idle_timeout: 0)
    this.listenerClient = postgres(this.connectionUri, {
      max: 1,
      idle_timeout: 0,
      onnotice: () => {}
    });

    // 2. Publisher pool
    this.publisherClient = postgres(this.connectionUri, {
      max: 5,
      idle_timeout: 30,
      onnotice: () => {}
    });

    // 3. Ensure large payload table exists
    await this.publisherClient.unsafe(`
      CREATE TABLE IF NOT EXISTS _synapse_event_payloads (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Start listening on channel
    await this.listenerClient.listen(this.channelName, async (rawPayload: string) => {
      try {
        const envelope = JSON.parse(rawPayload);

        // Deduplicate: ignore events published by this exact process instance
        if (envelope.o === this.instanceId) {
          return;
        }

        let eventData: unknown;

        if (envelope.ref && this.publisherClient) {
          // Offloaded large payload (>7.5KB)
          const rows = await this.publisherClient.unsafe('SELECT payload FROM _synapse_event_payloads WHERE id = $1', [
            envelope.ref
          ]);
          if (rows.length > 0) {
            eventData = JSON.parse(rows[0].payload);
          }
        } else {
          eventData = envelope.d;
        }

        // Deliver to in-process subscribers
        super.publish(envelope.t, eventData);
      } catch (err) {
        console.error('[PostgresEventHub] Erro ao processar mensagem LISTEN:', err);
      }
    });

    this.isInitialized = true;
  }

  /**
   * Publishes event locally and broadcasts via PostgreSQL LISTEN/NOTIFY.
   */
  override publish(topic: string, data: unknown): number {
    const localNotified = super.publish(topic, data);

    if (this.publisherClient && !this.isClosed) {
      const client = this.publisherClient;
      const serialized = JSON.stringify(data);

      if (serialized.length > 7500) {
        const refId = crypto.randomUUID();
        client
          .unsafe('INSERT INTO _synapse_event_payloads (id, payload) VALUES ($1, $2)', [refId, serialized])
          .then(() => {
            // Opportunistic TTL cleanup for records older than 5 minutes
            client
              .unsafe("DELETE FROM _synapse_event_payloads WHERE created_at < NOW() - INTERVAL '5 minutes'")
              .catch(() => {});

            return client.notify(this.channelName, JSON.stringify({ t: topic, ref: refId, o: this.instanceId }));
          })
          .catch((err) => {
            console.error('[PostgresEventHub] Erro ao persistir payload offloaded:', err);
          });
      } else {
        client.notify(this.channelName, JSON.stringify({ t: topic, d: data, o: this.instanceId })).catch((err) => {
          console.error('[PostgresEventHub] Erro no pg_notify:', err);
        });
      }
    }

    return localNotified;
  }

  /**
   * Gracefully ends connections and frees resources.
   */
  async close(): Promise<void> {
    this.isClosed = true;
    if (this.listenerClient) {
      await this.listenerClient.end();
      this.listenerClient = null;
    }
    if (this.publisherClient) {
      await this.publisherClient.end();
      this.publisherClient = null;
    }
    this.clear();
  }
}
