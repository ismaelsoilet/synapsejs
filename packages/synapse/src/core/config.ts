/**
 * SynapseJS - Enterprise & SaaS Configuration Contract
 *
 * Provides a declarative configuration entry point via `synapse.config.ts`.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SynapsePlugin {
  name: string;
  // biome-ignore lint/suspicious/noExplicitAny: generic boundary for framework server
  onBootstrap?: (server: any) => Promise<void> | void;
  onRequest?: (req: Request) => Promise<Response | null | undefined> | Response | null | void;
  onResponse?: (res: Response, req: Request) => Promise<Response> | Response;
  // biome-ignore lint/suspicious/noExplicitAny: generic boundary for database client
  onMigrate?: (db: any) => Promise<void> | void;
}

export interface SynapseConfig<TServices = Record<string, unknown>> {
  /**
   * Enterprise & SaaS service registry (e.g. mailer, stripe, storage, ai).
   * Can be an object or an async factory returning the services.
   */
  services?: TServices | (() => Promise<TServices>) | (() => TServices);

  /**
   * Multi-tenancy configuration.
   */
  multitenancy?: {
    strategy?: 'subdomain' | 'header' | 'cookie';
    headerName?: string;
  };

  /**
   * Background queue settings.
   */
  queue?: {
    driver?: 'sqlite' | 'memory' | 'redis';
    dbPath?: string;
    concurrency?: number;
  };

  /**
   * Infrastructure lifecycle plugins (onBootstrap, onRequest, onResponse, onMigrate).
   */
  plugins?: SynapsePlugin[];

  /**
   * Compiler and client bundler configuration.
   */
  compiler?: {
    vendorPackages?: string[];
  };

  /**
   * Trust proxy headers (cf-connecting-ip, x-forwarded-for) for rate limiting and IP resolution.
   */
  trustProxy?: boolean;

  /**
   * Max allowed payload bytes for RPC POST requests (default: 5MB).
   */
  maxRpcPayloadBytes?: number;

  /**
   * Max allowed payload bytes for Webhook POST requests (default: 10MB).
   */
  maxWebhookPayloadBytes?: number;

  /**
   * SSR Cache settings.
   */
  cache?: {
    maxEntries?: number;
  };

  /**
   * Image optimizer security settings.
   */
  imageOptimizer?: {
    allowedDomains?: string[];
  };
}

export function defineConfig<TServices = Record<string, unknown>>(
  config: SynapseConfig<TServices>
): SynapseConfig<TServices> {
  return config;
}

const CONFIG_FILENAMES = ['synapse.config.ts', 'synapse.config.js', 'synapse.config.mjs'];

/**
 * Discovers and loads `synapse.config.(ts|js|mjs)` from the application root.
 */
export async function loadSynapseConfig(appDir: string): Promise<SynapseConfig> {
  for (const filename of CONFIG_FILENAMES) {
    const candidate = path.join(appDir, filename);
    if (fs.existsSync(candidate)) {
      try {
        const mod = await import(candidate);
        const config = mod.default || mod;
        return typeof config === 'function' ? await config() : config;
      } catch (err: unknown) {
        const errMessage = err instanceof Error ? err.message : String(err);
        console.warn(`[SynapseConfig] Aviso ao carregar ${filename}: ${errMessage}`);
      }
    }
  }

  return {};
}
