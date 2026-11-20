import type { H3Event } from 'h3';
import type { GraphicsActorNaming } from '~~/shared/types/graphicsAsset';
import { readUserNames } from '@keepr/nuxt-layer/server/utils/userNames';
import { GRAPHICS_RECONCILIATION_ACTOR } from '~~/shared/utils/graphicsAssetReconciliation';
import { GRAPHICS_RETENTION_ACTOR } from '~~/shared/utils/graphicsAssetRetention';

/**
 * What an administrator surface calls an actor from before this Installation
 * had people.
 *
 * ADR-0010 leaves anonymous-era rows exactly as they are: a Graphics Ingestion
 * Operation started before its cutover, and every Evidence entry written for
 * one, names a Graphics Author Session that no longer exists and never had a
 * person attached. That is an accurate record of the era, so it is labelled
 * rather than rewritten.
 */
export const ANONYMOUS_ERA_ACTOR_NAME = 'anonymous era';

/**
 * The shape of the identity the retired Graphics Author Session issued:
 * `crypto.randomUUID()`. A User's id, as Keepr Accounts issues it, has no
 * dashes, and a machine actor is a named word (`graphics-retention-policy` for
 * a sweep), so a dashed UUID is an anonymous-era author and nothing else.
 */
const ANONYMOUS_ERA_ACTOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The actors that are the system's own decisions, recorded under a name no User has. */
const MACHINE_ACTORS: ReadonlySet<string> = new Set([
	GRAPHICS_RETENTION_ACTOR,
	GRAPHICS_RECONCILIATION_ACTOR,
]);

/** Who is reading: the one User whose name this Installation can vouch for by itself. */
export interface ActorNameReader {
	id: string;
	name: string;
	email: string;
}

/** The actors among these that may be a User other than the reader: who Keepr Accounts is asked about. */
function actorsToAskAbout(actors: Iterable<string>, reader: ActorNameReader | null): string[] {
	return [...actors].filter(
		(actor) =>
			actor !== reader?.id && !ANONYMOUS_ERA_ACTOR.test(actor) && !MACHINE_ACTORS.has(actor),
	);
}

/**
 * What to call each of these actors, as the reading is taken.
 *
 * The Evidence Ledger records who acted, as a User id, and never what they
 * were called. Stream Keepr holds no Users (ADR-0141), so a name is read as
 * the page is: the reader's own from the Identity Proof of the request in
 * hand, by the name Keepr Accounts vouches for now or their address when that
 * is blank; another User's as Keepr Accounts told this reader (`userNames`,
 * ADR-0145). An anonymous-era author is labelled. Every other actor is
 * answered as it was recorded: a machine actor's name, and a User Keepr
 * Accounts did not name, whether no User has the id, they share no
 * Organisation with the reader, or Keepr Accounts could not be asked.
 *
 * The answer covers every actor asked about, so a caller renders
 * `names[actor]` and never has to know which kind it is holding.
 */
export function graphicsActorNames(
	actors: Iterable<string>,
	reader: ActorNameReader | null,
	userNames: Readonly<Record<string, string>> = {},
): Record<string, string> {
	const asked = [...new Set(actors)].filter((actor) => actor.length > 0);

	return Object.fromEntries(
		asked.map((actor) => [
			actor,
			reader !== null && actor === reader.id
				? reader.name.trim() || reader.email
				: ANONYMOUS_ERA_ACTOR.test(actor)
					? ANONYMOUS_ERA_ACTOR_NAME
					: !MACHINE_ACTORS.has(actor) && Object.hasOwn(userNames, actor)
						? userNames[actor]!
						: actor,
		]),
	);
}

/**
 * One administrator reading, with every identity in it named for the Graphics
 * Administrator reading it.
 *
 * The three readings that carry actors (the cockpit, one queue inspection, and
 * a page of the ledger) each end in this, and differ only in which identities
 * the payload holds. Keepr Accounts is asked only about an actor who may be
 * another User, and not at all when there is none; what it cannot answer leaves
 * the reading whole, with ids (`readUserNames`).
 */
export async function withActorNames<Reading>(
	event: H3Event,
	reader: ActorNameReader,
	reading: Reading,
	actors: Iterable<string>,
): Promise<Reading & GraphicsActorNaming> {
	const asked = [...actors];
	const userNames = await readUserNames(event, actorsToAskAbout(asked, reader));
	return { ...reading, actorNames: graphicsActorNames(asked, reader, userNames) };
}
