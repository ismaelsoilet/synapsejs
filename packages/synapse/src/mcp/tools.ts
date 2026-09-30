/**
 * SynapseJS - Model Context Protocol Tool Inventory
 *
 * The declarative list of tools the MCP server registers: names, descriptions and
 * input schemas, with no runtime dependency. Keeping it here means the count the
 * documentation quotes is derived from the registered list rather than maintained by
 * hand, and `synapse info` can report it without loading the JSON-RPC server.
 */

import { PATH_SEGMENT_PATTERN } from '../core/path-guard';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'synapse_get_repo_map',
    description: 'Get compressed codebase skeleton map (.codebase/repo-map.d.ts) for AI context (<3000 tokens)',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'synapse_get_db_schema',
    description:
      'Get the centralized database schema catalog (.codebase/db-schema.d.ts) for AI context and type-safe relational queries',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'synapse_check',
    description:
      'Run machine-centric compiler diagnostics, returning exact JSON coordinates (file, line, col, message)',
    inputSchema: {
      type: 'object',
      properties: {
        targetFile: { type: 'string', description: 'Optional specific file to check' }
      }
    }
  },
  {
    name: 'synapse_split',
    description: 'Run slice splitter and leak verification gates to enforce server/client isolation and zero leakage',
    inputSchema: {
      type: 'object',
      properties: {
        targetSlice: { type: 'string', description: 'Optional specific slice name to split' }
      }
    }
  },
  {
    name: 'synapse_run_pbt',
    description: 'Execute Fast-Check Property-Based Testing (PBT) invariant test suite across all slices',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'synapse_scaffold_slice',
    description:
      'Scaffold a new fullstack atomic vertical slice with TypeBox, Result, Action, React UI, and PBT oracles',
    inputSchema: {
      type: 'object',
      required: ['domain', 'name'],
      properties: {
        domain: {
          type: 'string',
          pattern: PATH_SEGMENT_PATTERN,
          description: 'Domain name (e.g. billing, customers, orders)'
        },
        name: {
          type: 'string',
          pattern: PATH_SEGMENT_PATTERN,
          description: 'Slice name in kebab-case (e.g. cancel-subscription)'
        },
        template: {
          type: 'string',
          enum: ['create', 'list', 'update', 'delete', 'login', 'oauth-github', 'crud'],
          description: 'Optional slice template shape (default: create)'
        },
        fields: {
          type: 'string',
          description:
            'Optional fields grammar, e.g. "name:string,email:string,status:enum(ACTIVE|INACTIVE),price:number"'
        }
      }
    }
  },
  {
    name: 'synapse_contract',
    description:
      'Return the machine contract: slice exports and suffixes, Result and HTTP semantics, session rules, addressing, SSR behavior and the gates to run',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'synapse_migrate',
    description: 'Auto-discover and apply sliceSchema DDL declarations across slices into the active database',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'synapse_check_db_drift',
    description:
      'Inspects live database catalog against sliceSchema DDL contracts, identifying missing tables, missing columns, and orphan tables',
    inputSchema: { type: 'object', properties: {} }
  },
  {
    name: 'synapse_diff_impact',
    description:
      'Analyzes cross-slice dependencies (Foreign Keys, shared module imports, and table references) to report all slices impacted by a file or table change',
    inputSchema: {
      type: 'object',
      required: ['target'],
      properties: {
        target: {
          type: 'string',
          description: 'Slice file path, slice name, shared module path, or table name'
        }
      }
    }
  },
  {
    name: 'synapse_rollback',
    description: 'Roll back applied sliceSchema migrations by executing their -- down: statements',
    inputSchema: {
      type: 'object',
      properties: {
        targetSlice: { type: 'string', description: 'Optional target slice to rollback' },
        steps: { type: 'number', description: 'Number of recent migrations to rollback (default: 1)' }
      }
    }
  },
  {
    name: 'synapse_test_gate',
    description:
      'Execute Fast-Check PBT oracles and immediately triage failures with Jev System One semantic test-gate to prevent LLM token waste',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'synapse_abort_check',
    description:
      'Evaluate plan and error history with Jev System One to detect doomed trajectories, circular loops, or high-risk refactor dead ends',
    inputSchema: {
      type: 'object',
      required: ['plan', 'history'],
      properties: {
        plan: { type: 'string', description: 'Proposed implementation plan or architectural change' },
        history: { type: 'string', description: 'Recent attempt history, error logs, or failure reasons' }
      }
    }
  },
  {
    name: 'synapse_verify_completion',
    description:
      'Verify slice implementation and test outputs against acceptance criteria using Jev System One before committing work',
    inputSchema: {
      type: 'object',
      required: ['criteria', 'output'],
      properties: {
        criteria: { type: 'string', description: 'Acceptance criteria or requirement specifications' },
        output: {
          type: 'string',
          description: 'Actual implementation summary, test output, or slice behavior'
        }
      }
    }
  },
  {
    name: 'synapse_reasoning_effort',
    description:
      'Dynamically modulate agent reasoning effort (Astra-Jev) to low/medium/high based on step context (lowering effort for mechanical commands like split/migrate/skeleton)',
    inputSchema: {
      type: 'object',
      required: ['context'],
      properties: {
        context: {
          type: 'string',
          description: 'Immediate command or task context, e.g. "synapse split", "git commit"'
        },
        provider: {
          type: 'string',
          description: 'Target LLM provider, e.g. "deepseek", "anthropic", "openai"'
        },
        sessionContextTokens: {
          type: 'number',
          description: 'Estimated session context token count to protect prompt cache'
        }
      }
    }
  },
  {
    name: 'synapse_triage_error',
    description:
      'Triage an arbitrary test failure or execution error log using Jev System One to classify root causes (env_missing vs flaky_transient vs deep_logic) and avoid token waste',
    inputSchema: {
      type: 'object',
      required: ['failureLog'],
      properties: {
        failureLog: {
          type: 'string',
          description: 'Error log, stack trace or terminal output to triage'
        }
      }
    }
  },
  {
    name: 'synapse_route_task',
    description: 'Semantically route a development task to the optimal model/reasoning tier via Jev System One',
    inputSchema: {
      type: 'object',
      required: ['task'],
      properties: {
        task: {
          type: 'string',
          description: 'Description of the coding, refactoring, or diagnostic task'
        }
      }
    }
  },
  {
    name: 'synapse_evaluate_nudge',
    description:
      'Evaluate whether an agent is prematurely stopping or needs a proactive nudge to continue verification',
    inputSchema: {
      type: 'object',
      required: ['transcriptTail'],
      properties: {
        transcriptTail: {
          type: 'string',
          description: 'Recent transcript steps or conversation history tail'
        }
      }
    }
  }
];

/** The registered tool names, in registration order. */
export const MCP_TOOL_NAMES: string[] = MCP_TOOLS.map((tool) => tool.name);
