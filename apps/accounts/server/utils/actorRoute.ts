import type { H3Event } from 'h3';
import type { IdentityDatabase } from '~~/server/db';
import type { Actor } from './actor';
import { getRequestHost, toWebRequest } from 'h3';
import { db } from '~~/server/db';
import { requestActor } from './actor';
import { serverAuth } from './auth';
import { answerRefusals } from './refusal';

/**
 * Runs the work of one of Keepr Accounts' own routes that needs a Session, as
 * the request's Actor, answering a refusal with its status and code.
 */
export async function answerAsActor<T>(
	event: H3Event,
	work: (database: IdentityDatabase, actor: Actor) => Promise<T>,
) {
	return await answerRefusals(event, async () => {
		const actor = await requestActor(serverAuth(getRequestHost(event)), toWebRequest(event));
		return await work(db(), actor);
	});
}
