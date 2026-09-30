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
