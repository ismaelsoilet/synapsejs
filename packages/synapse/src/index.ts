/**
 * SynapseJS - The Machine-Centric AI-Native Fullstack Engine
 *
 * Official Public Package Entry Point
 */

// 2. Convenience Re-exports for JIT Validation & PBT
export { type Static, type TSchema, Type } from '@sinclair/typebox';
export { Value } from '@sinclair/typebox/value';
// 1. Kernel Types & Functional Error Handling
export * from './core/index';
export { type RpcTransportError, rpcCall, rpcTransportFailure } from './core/rpc-client';

import * as fc from 'fast-check';

export * from './client';
export { type DiagnosticIssue, type DiagnosticReport, runMachineVerifications } from './compiler/agent-diagnostic-json';
export { compressRepositoryAST } from './compiler/ast-daemon-compressor';
export {
  buildClientBundle,
  buildVendorBundle,
  VENDOR_BUNDLE_NAME,
  VENDOR_BUNDLE_URL
} from './compiler/client-bundler';
export {
  type MachineContract,
  machineContract,
  renderContractJson,
  renderContractMarkdown
} from './compiler/contract';
export {
  type ColumnDefinition,
  type DatabaseCatalog,
  generateDatabaseSchemaCatalog,
  mapSqlTypeToTs,
  parseDdlToCatalog,
  type TableDefinition,
  toPascalCase
} from './compiler/db-schema-generator';
export { type ParsedField, parseFields } from './compiler/fields-parser';
export {
  analyzeImpact,
  type ImpactAnalysisReport,
  type ImpactedSlice,
  type ImpactReason
} from './compiler/impact-analyzer';
export {
  type BidirectionalDdl,
  type MigrationReport,
  type MigrationResult,
  parseBidirectionalDdl,
  type RollbackOptions,
  type RollbackReport,
  type RollbackResult,
  rollbackSliceMigrations,
  runSliceMigrations
} from './compiler/migration-runner';
export {
  ORACLE_DIR_NAME,
  type OracleCaseResult,
  type OracleErrorCode,
  type OracleReport,
  type OracleSliceResult,
  oracleWrapperSource,
  parseOracleJunit,
  runSliceOracles
} from './compiler/oracle-runner';
export { type ScaffoldError, type ScaffoldErrorCode, scaffoldCrud, scaffoldSlice } from './compiler/scaffolder';
export { orderSlicesByDag, parseTableDependencies } from './compiler/schema-dag';
export {
  checkSchemaDrift,
  type MissingColumnInfo,
  type MissingTableInfo,
  type SchemaDriftReport
} from './compiler/schema-drift';
export {
  findSliceFiles,
  resolveSlicesDir,
  SLICE_EXTENSION,
  type SlicesDirError,
  type SlicesDirErrorCode,
  type SlicesResolution
} from './compiler/slice-discovery';
export {
  artifactDirectory,
  type SplitArtifact,
  type SplitDiagnostic,
  type SplitResult,
  type SplitVerification,
  splitSlice,
  verifySplit,
  writeSplitArtifacts
} from './compiler/slice-splitter';
export { buildStandalone, type StandaloneBuildResult } from './compiler/standalone-builder';
export type { SliceOracle, SliceOracleCase } from './core/oracle';
export {
  clearSession,
  currentRoles,
  DEFAULT_SESSION_MAX_AGE_SECONDS,
  ROLES_COOKIE,
  SESSION_COOKIE,
  sessionCookie,
  storeSession
} from './core/session-cookie';
// 5. Model Context Protocol (MCP) Server
export { SynapseMcpServer } from './mcp/server';
export * from './runtime/discovery-rules';
// 4. Runtime, Queue & Zero-Wiring HTTP Server
export {
  EventHub,
  type EventListener,
  getEventHub,
  resetEventHub,
  type UnsubscribeFn
} from './runtime/event-hub';
export {
  PostgresEventHub,
  type PostgresEventHubOptions
} from './runtime/postgres-event-hub';
export { type JobRecord, QueueEngine } from './runtime/queue-engine';
export {
  type RateLimitOptions,
  type RateLimitResult,
  TokenBucketRateLimiter
} from './runtime/rate-limiter';
export {
  type DiscoveredSlice,
  type SliceLoadError,
  type SliceLoaderContext,
  type SliceMetadata,
  SynapseServer
} from './runtime/server';
export { fc };
