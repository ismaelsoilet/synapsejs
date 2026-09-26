/**
 * SynapseJS - The Machine-Centric AI-Native Fullstack Engine
 * 
 * Official Public Package Entry Point
 */

// 1. Kernel Types & Functional Error Handling
export * from './core/index';
export { rpcCall, rpcTransportFailure, type RpcTransportError } from './core/rpc-client';

// 2. Convenience Re-exports for JIT Validation & PBT
export { Type, type Static, type TSchema } from '@sinclair/typebox';
export { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
export { fc };

// 3. Compiler & AST Tooling
export { runSliceMigrations, type MigrationReport, type MigrationResult } from './compiler/migration-runner';
export {
  findSliceFiles,
  resolveSlicesDir,
  SLICE_EXTENSION,
  type SlicesResolution,
  type SlicesDirError,
  type SlicesDirErrorCode
} from './compiler/slice-discovery';
export {
  artifactDirectory,
  splitSlice,
  verifySplit,
  writeSplitArtifacts,
  type SplitArtifact,
  type SplitDiagnostic,
  type SplitResult,
  type SplitVerification
} from './compiler/slice-splitter';
export { scaffoldSlice, type ScaffoldError, type ScaffoldErrorCode } from './compiler/scaffolder';
export { compressRepositoryAST } from './compiler/ast-daemon-compressor';
export {
  runSliceOracles,
  parseOracleJunit,
  oracleWrapperSource,
  ORACLE_DIR_NAME,
  type OracleReport,
  type OracleSliceResult,
  type OracleCaseResult,
  type OracleErrorCode
} from './compiler/oracle-runner';
export type { SliceOracle, SliceOracleCase } from './core/oracle';
export { runMachineVerifications, type DiagnosticReport, type DiagnosticIssue } from './compiler/agent-diagnostic-json';

// 4. Runtime & Zero-Wiring HTTP Server
export { SynapseServer, type DiscoveredSlice } from './runtime/server';

// 5. Model Context Protocol (MCP) Server
export { SynapseMcpServer } from './mcp/server';
