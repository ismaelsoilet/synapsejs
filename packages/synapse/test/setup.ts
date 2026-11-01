/**
 * Test preload for the framework suite.
 *
 * The suite exercises the documented local-development behaviour (identity headers
 * are honoured without a session secret), so it opts in explicitly with the named
 * flag instead of relying on an unset environment — which now resolves to an
 * anonymous session. Tests that assert the default posture delete this variable
 * for the duration of the test.
 */
process.env.SYNAPSE_DEV_HEADERS = 'true';

// The suite imports React; a production build omits `act`, which the DOM tests
// need. Set this in the preload so the documented `bun test` command works
// without an external NODE_ENV.
process.env.NODE_ENV = 'test';

// The integration fixtures compile a temporary application (splitter + bundler).
// The timeout lives in bunfig.toml so the documented `bun test` command inherits it.
