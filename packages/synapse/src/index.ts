/**
 * SynapseJS - The Machine-Centric AI-Native Fullstack Engine
 * 
 * Official Public Package Entry Point
 */

// 1. Kernel Types & Functional Error Handling
export * from './core/index';

// 2. Convenience Re-exports for JIT Validation & PBT
export { Type, type Static, type TSchema } from '@sinclair/typebox';
export { Value } from '@sinclair/typebox/value';
import * as fc from 'fast-check';
export { fc };

// 3. Compiler & AST Daemon Engine
export { runSliceMigrations, type MigrationReport } from './compiler/migration-runner';
export { getFastDiagnostics } from './compiler/fast-diagnostics';
export { splitSlice, type SplitResult } from './compiler/slice-splitter';
export { scaffoldSlice } from './compiler/scaffolder';
export { compressRepositoryAST } from './compiler/ast-daemon-compressor';
export { runMachineVerifications, type DiagnosticReport, type DiagnosticIssue } from './compiler/agent-diagnostic-json';

// 4. Runtime & Zero-Wiring HTTP Server
export { SynapseServer, type DiscoveredSlice } from './runtime/server';

// 5. Model Context Protocol (MCP) Server
export { SynapseMcpServer } from './mcp/server';
