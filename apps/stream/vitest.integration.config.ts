import { defineConfig } from 'vitest/config';
import { CHECKOUT_TSCONFIG } from './build/checkoutTsconfig.ts';
import { integrationServerCount } from './test/integration/state.ts';

// One server per worker (test/integration/globalSetup.ts): files run in
// parallel only across servers, never two against one database. A file that
// hears realtime runs like any other: its server's Events have their objects
// in the realtime dev Worker beside that server.
const servers = integrationServerCount();

export default defineConfig({
	// Named, or Vite goes looking and climbs out of this checkout (build/checkoutTsconfig.ts).
	tsconfig: CHECKOUT_TSCONFIG,
	test: {
		globalSetup: ['test/integration/globalSetup.ts'],
		setupFiles: ['test/integration/selectServer.ts', 'test/integration/requestLedgerReport.ts'],
		include: ['test/integration/**/*.test.ts'],
		environment: 'node',
		testTimeout: 30000,
		hookTimeout: 60000,
		fileParallelism: servers > 1,
		maxWorkers: servers,
		silent: 'passed-only',
	},
});
