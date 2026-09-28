---
name: jev-harness
description: Repository adapter for Jev System One. Uses fast semantic decisions (70-300ms) to gate tests, prevent token waste, and route models.
license: MIT
---

# Local Jev Harness Adapter

This repository is connected to the global **Jev System One Harness**.

## Usage in this repo:
- CLI command: `jev-harness [test-gate | abort-check | route | verify | status | metrics | mcp]`
- Local configuration: `.jev.json` or `.env`
- Global engine: `jev-harness`

## Rules for AI Coding Agents:
1. When a test fails, run `jev-harness test-gate` before spending 50k tokens prompting an LLM.
2. If `skip_llm=true`, solve the dependency or syntax issue deterministically.
3. Use `jev-harness abort-check` before attempting risky refactors or after 2 consecutive errors.
4. Run `jev-harness verify` before marking tasks as completed.
