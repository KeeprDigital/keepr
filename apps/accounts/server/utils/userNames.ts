import type { IdentityDatabase } from '~~/server/db';
import type { UserNamesAnswer } from '@keepr/nuxt-layer/shared/utils/userNames';
import type { KeeprAuth } from './auth';
import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import { inJsonArray } from '@keepr/nuxt-layer/server/utils/db';
import { schema } from '~~/server/db';
import { askedUserIds, USER_NAMES_MAX_IDS } from '@keepr/nuxt-layer/shared/utils/userNames';
import { isDisabled } from './identityProof';
import { KeeprRefusal } from './refusal';

/**
 * What Keepr Accounts tells one User of others: the name of each User `request`
 * asks about by id who shares an Organisation with the Session's own User, and
 * nothing of anyone else (ADR-0145). An App forwards the cookie of the request
 * it is answering, as it does for an Identity Proof, so the asker is a Session
 * and never an App: nothing here answers to a credential of an App's own.
 *
 * Only a name is answered: no email, role, Organisation or disabled mark. An id
 * no User has, a User the asker shares no Organisation with and a User with a
 * blank name are all left out alike, by one statement that runs the same
 * whichever they are, so the answer cannot tell one from another. It lists
 * nobody: an asker learns of a User only by an id they already hold.
 *
 * A Keepr Administrator is answered as anyone is. They find any User on the
 * platform screen, where that is what they came to do; an App's page is an
 * Organisation's data, which being a Keepr Administrator opens none of.
 */
export async function answerUserNames(
	auth: KeeprAuth,
	database: IdentityDatabase,
	request: Request,
): Promise<UserNamesAnswer> {
	// A lookup renews no Session: its answer carries no cookie back to a browser,
	// so a renewal made here would be one the browser never heard of.
	const signedIn = await auth.api.getSession({
		headers: request.headers,
		query: { disableRefresh: true },
	});
	// As no Identity Proof is minted: none for an ended Session or a disabled User's.
	if (!signedIn || isDisabled(signedIn.user))
		throw new KeeprRefusal(401, 'SIGNED_OUT', 'Sign in to do this.');

	const ids = askedUserIds(new URL(request.url));
	if (ids.length > USER_NAMES_MAX_IDS)
		throw new KeeprRefusal(
			400,
			'TOO_MANY_USER_IDS',
			`Ask about at most ${USER_NAMES_MAX_IDS} Users at once.`,
		);

	const theirs = alias(schema.member, 'theirs');
	const askers = alias(schema.member, 'askers');
	const shared = await database
		.selectDistinct({ id: schema.user.id, name: schema.user.name })
		.from(schema.user)
		.innerJoin(theirs, eq(theirs.userId, schema.user.id))
		.innerJoin(
			askers,
			and(eq(askers.organizationId, theirs.organizationId), eq(askers.userId, signedIn.user.id)),
		)
		.where(inJsonArray(schema.user.id, ids));

	return {
		names: Object.fromEntries(
			shared.filter(({ name }) => name.trim().length > 0).map(({ id, name }) => [id, name]),
		),
	};
}
