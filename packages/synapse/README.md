# SynapseJS ⚡

> **The Machine-Centric AI-Native Fullstack Engine for Autonomous AI Coding Agents.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Bun](https://img.shields.io/badge/Bun-v1.2+-black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue)](https://www.typescriptlang.org)

SynapseJS is a fullstack web framework and agentic runtime designed from the ground up to minimize cognitive fragmentation and maximize compound success rates for autonomous LLM coding agents (Cursor, Claude Code, Windsurf, Antigravity).

---

## ⚡ Key Paradigm Pillars

1. **Vertical Slices & Locality of Behavior (LoB):** Input contracts (TypeBox), DDL database schemas (`sliceSchema`), server actions, React UI components, and property-based test oracles (Fast-Check) live in a single contiguous file ($N = 1$).
2. **Zero-Throw Functional Flow:** Control flow via Algebraic Data Types: `Result<T, E>` (`Ok`, `Err`), avoiding untyped exceptions and hidden side-effects.
3. **AST-Driven Auto-Migrations:** Discovers `sliceSchema` declarations across all slices and idempotently synchronizes the database on startup.
4. **Universal Multi-Database Engine:** High-performance embedded SQLite (WAL mode) and pooled PostgreSQL (`DATABASE_URL`), seamlessly swappable.
5. **Native Model Context Protocol (MCP):** Stdio JSON-RPC 2.0 server providing native tools for AI agents (`synapse_get_repo_map`, `synapse_check`, `synapse_run_pbt`, `synapse_scaffold_slice`, `synapse_migrate`).
6. **AST Skeletonizer (< 3,000 Tokens):** Compresses the entire repository into strict types and signatures (`.codebase/repo-map.d.ts`) to fit easily into model context windows.
7. **Fast Incremental Diagnostics (< 200ms):** Structured JSON compiler diagnostics for instantaneous agent self-healing loops.

---

## 🚀 Quick Start

### 1. Create a New SynapseJS Project

```bash
bunx synapsejs new my-app
cd my-app
bun install
```

### 2. Start the Development Server

```bash
bun run dev
```

Visit `http://localhost:3000` to access the interactive Vertical Slice Hub.

### 3. Scaffold a New Vertical Slice

```bash
bun run new-slice users register-user
```

This creates `src/slices/users/register-user.slice.tsx` containing input validation, declarative table schema, server action, React UI form, and Fast-Check PBT oracle.

### 4. Run Property-Based Invariant Tests

```bash
bun run test
```

### 5. Start the Native MCP Server

```bash
bun run mcp
```

---

## 📦 Package API Exports

```typescript
import {
  // Functional Error Handling
  Result,
  Ok,
  Err,
  unwrap,
  unwrapOr,
  map,
  mapErr,
  Option,
  Some,
  None,

  // Runtime & Database
  SynapseServer,
  getDatabase,
  type DatabaseClient,
  MockDatabaseClient,

  // Auth & Session
  AnonymousSession,
  createSession,
  requireAuth,
  hasRole,
  type SessionContext,

  // JIT Validation & PBT
  Type,
  type Static,
  Value,
  fc,

  // Compiler & Diagnostics
  splitSlice,
  scaffoldSlice,
  compressRepositoryAST,
  getFastDiagnostics,
  runMachineVerifications,
  runSliceMigrations,

  // MCP Server
  SynapseMcpServer
} from 'synapsejs';
```

---

## 📄 License

MIT © [Ismael Soilet](https://github.com/ismaelsoilet)
