import type { IntegrationServer, IntegrationServerAddress } from './servers';
import process from 'node:process';
import { main as reapStrandedRuns } from '../../scripts/reap.mjs';
import { acquireRunSlots, RUN_SLOT_COSTS } from '@keepr/tooling/scripts/slots.mjs';
import { INTEGRATION_OPERATOR_COOKIE } from './environment';
import { integrationServerEnv } from './helpers';
import { prepareIntegrationD1 } from './integrationD1';
import { freePorts, INTEGRATION_SERVER_LIST_ENV, startIntegrationServer } from './servers';
import {
	announceIntegrationMode,
	integrationServerCount,
	integrationServerPersistDir,
	resetIntegrationWranglerState,
} from './state';
import './disable-fs-watch.mjs';

/**
 * That the server is up, its database is migrated, and the operator is admitted.
 *
 * `/api/events` is the readiness probe because it reads D1: a server that
 * answers it has run its migrations. It is also behind the Session boundary, so
 * this proves the second thing as well: that the server's Accounts Stand-in
 * answers its binding and vouches for the suite's operator. Both facts are worth
 * failing here for. Without the second, a stand-in the server cannot reach would
 * surface as every test in the run answering 503, with nothing naming the cause.
 */
async function assertIntegrationServerReady(server: IntegrationServer) {
	const response = await fetch(new URL('/api/events', server.url), {
		headers: { cookie: INTEGRATION_OPERATOR_COOKIE },
	});
	if (!response.ok) {
		const detail = await response.text();
		throw new Error(
			`Integration server database readiness check failed with status ${response.status}: ${detail}`,
		);
	}
}

async function startReadyServer(persistDir: string, port: number): Promise<IntegrationServer> {
	await resetIntegrationWranglerState(persistDir);
	await prepareIntegrationD1(persistDir);
	const server = await startIntegrationServer({ persistDir, env: integrationServerEnv, port });
	try {
		await assertIntegrationServerReady(server);
	} catch (error) {
		await server.stop();
		throw error;
	}
	return server;
}

/**
 * Start one server per test worker, each over its own database.
 *
 * Test files share library-wide state, so a server serves one file at a time;
 * `selectServer.ts` pins each worker to the server matching its pool id. Each
 * server publishes to, and hands sockets to, the objects of the realtime dev
 * Worker it started beside itself, which no other server reaches: two servers
 * that both create Event 17 hear nothing of each other.
 */
async function startIntegrationServers(): Promise<IntegrationServer[]> {
	const persistDirs = Array.from({ length: integrationServerCount() }, (_, index) =>
		integrationServerPersistDir(index + 1),
	);
	const ports = await freePorts(persistDirs.length);
	const started = await Promise.allSettled(
		persistDirs.map((persistDir, index) => startReadyServer(persistDir, ports[index]!)),
	);
	const servers = started.flatMap((result) =>
		result.status === 'fulfilled' ? [result.value] : [],
	);
	const failed = started.find((result) => result.status === 'rejected');
	if (failed) {
		await Promise.all(servers.map((server) => server.stop()));
		throw failed.reason;
	}
	return servers;
}

export async function setup() {
	// First: the servers inherit this process's environment, and anything here
	// that reads the environment must see the same answer they do.
	announceIntegrationMode();

	// The whole machine's run slots, before anything starts: these tests time
	// real requests against several servers, and another suite beside them, in
	// this worktree or any other, makes every result meaningless.
	const slots = await acquireRunSlots({
		want: RUN_SLOT_COSTS.integration,
		label: 'integration suite',
	});

	// A workerd stranded by a killed session still holds sqlite locks on the
	// persist directories; sweep them before touching that state.
	await reapStrandedRuns();

	const servers = await startIntegrationServers().catch((error) => {
		slots.release();
		throw error;
	});
	const address = ({ url, persistDir }: IntegrationServer): IntegrationServerAddress => ({
		url,
		persistDir,
	});
	process.env[INTEGRATION_SERVER_LIST_ENV] = JSON.stringify(servers.map(address));

	return async () => {
		await Promise.all(servers.map((server) => server.stop()));
		await Promise.all(servers.map((server) => resetIntegrationWranglerState(server.persistDir)));
		slots.release();
	};
}
