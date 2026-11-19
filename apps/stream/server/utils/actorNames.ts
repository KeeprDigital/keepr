import type { GraphicsActorNaming } from '~~/shared/types/graphicsAsset';

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

/** Who is reading: the one User whose name this Installation can vouch for. */
export interface ActorNameReader {
	id: string;
	name: string;
	email: string;
}

/**
 * What to call each of these actors, as the reading is taken.
 *
 * The Evidence Ledger records who acted, as a User id, and never what they
 * were called. Stream Keepr holds no Users: a name reaches it only in the
 * Identity Proof of the request in hand (ADR-0141). So the reader's own id is
 * named, by the name Keepr Accounts vouches for now, or their address when that
 * is blank; an anonymous-era author is labelled; and every other actor, another
 * User's id and a machine actor's name alike, is answered as it was recorded.
 *
 * The answer covers every actor asked about, so a caller renders
 * `names[actor]` and never has to know which kind it is holding.
 */
export function graphicsActorNames(
	actors: Iterable<string>,
	reader: ActorNameReader | null,
): Record<string, string> {
	const asked = [...new Set(actors)].filter((actor) => actor.length > 0);

	return Object.fromEntries(
		asked.map((actor) => [
			actor,
			reader !== null && actor === reader.id
				? reader.name.trim() || reader.email
				: ANONYMOUS_ERA_ACTOR.test(actor)
					? ANONYMOUS_ERA_ACTOR_NAME
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
 * the payload holds.
 */
export function withActorNames<Reading>(
	reader: ActorNameReader,
	reading: Reading,
	actors: Iterable<string>,
): Reading & GraphicsActorNaming {
	return { ...reading, actorNames: graphicsActorNames(actors, reader) };
}
