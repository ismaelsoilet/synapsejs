/**
 * SynapseJS framework version.
 *
 * The version is declared exactly once — in the published package manifest — and
 * every machine-readable surface (health, MCP handshake, `synapse info`, the build
 * output) reads it from here. No surface is permitted to carry a literal of its own.
 */

import manifest from '../package.json';

export const SYNAPSE_VERSION: string = (manifest as { version: string }).version;
