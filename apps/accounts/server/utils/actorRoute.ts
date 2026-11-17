import type { H3Event } from 'h3';
import type { IdentityDatabase } from '~~/server/db';
import type { Actor } from './actor';
import type { KeeprAuth } from './auth';
import { getRequestHost, toWebRequest } from 'h3';
import { db } from '~~/server/db';
import { requestActor } from './actor';
import { serverAuth } from './auth';
import { answerRefusals } from './refusal';

/** What one of Keepr Accounts' own routes works with. */
export interface RouteContext {
	/** The Better Auth instance that answers the request's host. */
	auth: KeeprAuth;
	database: IdentityDatabase;
	request: Request;
}

/** Runs the work of one of Keepr Accounts' own routes, answering a refusal with its status and code. */
export async function answerRoute<T>(event: H3Event, work: (context: RouteContext) => Promise<T>) {
	return await answerRefusals(
		event,
		async () =>
			await work({
				auth: serverAuth(getRequestHost(event)),
				database: db(),
				request: toWebRequest(event),
			}),
	);
}

/**
 * Runs the work of one of Keepr Accounts' own routes that needs a Session, as
 * the request's Actor, answering a refusal with its status and code.
 */
export async function answerAsActor<T>(
	event: H3Event,
	work: (database: IdentityDatabase, actor: Actor) => Promise<T>,
) {
	return await answerRoute(
		event,
		async ({ auth, database, request }) => await work(database, await requestActor(auth, request)),
	);
}
