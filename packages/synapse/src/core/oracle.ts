/**
 * SynapseJS - Slice Oracle Contract
 *
 * A slice owns its invariants. The oracle is plain data + functions so it never
 * pulls a test library into production code: the runner registers each case with
 * Bun's real test runner from a generated companion file.
 */

export interface SliceOracleCase {
  name: string;
  run: () => unknown | Promise<unknown>;
}

export interface SliceOracle {
  description?: string;
  /** Preferred shape: one named case per invariant, for per-invariant reporting. */
  cases?: SliceOracleCase[];
  /** Legacy shape: a single unnamed routine. Reported as one case. */
  run?: () => unknown | Promise<unknown>;
}
