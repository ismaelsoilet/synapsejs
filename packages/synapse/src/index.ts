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

export { type DiagnosticIssue, type DiagnosticReport, runMachineVerifications } from './compiler/agent-diagnostic-json';
export { compressRepositoryAST } from './compiler/ast-daemon-compressor';
export {
  type MachineContract,
  machineContract,
  renderContractJson,
  renderContractMarkdown
} from './compiler/contract';
// 3. Compiler & AST Tooling
export { type MigrationReport, type MigrationResult, runSliceMigrations } from './compiler/migration-runner';
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
export { type ScaffoldError, type ScaffoldErrorCode, scaffoldSlice } from './compiler/scaffolder';
export { orderSlicesByDag, parseTableDependencies } from './compiler/schema-dag';
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
export { type JobRecord, QueueEngine } from './runtime/queue-engine';
export {
  type DiscoveredSlice,
  type SliceLoadError,
  type SliceLoaderContext,
  SynapseServer
} from './runtime/server';
export { fc };
