/**
 * What an app lets one socket do, decided by the app's Worker before it hands
 * the socket to the object, and enforced by the object from then on.
 *
 * A channel is named exactly, or by a prefix ending `*`: `room:12:*` covers
 * every channel that starts `room:12:`. A `*` anywhere else is itself.
 */
export interface Grant {
	/**
	 * Who the caller is, in the app's own terms. A client replaces only the
	 * sockets of its own identity, so one caller cannot stand in another's place by
	 * naming its client id.
	 */
	identity: string;
	/** The channels it may attach to, and whose presence it may watch. */
	hear: readonly string[];
	/** The channels it may enter presence on. */
	enter?: readonly string[];
	/**
	 * Names the app can later disconnect it by (`disconnect`), fixed when the
	 * socket is accepted: a credential's holder and the credential, so replacing
	 * it closes the sockets the earlier ones admitted and spares the new one's.
	 */
	tags?: readonly string[];
}

/** What a disconnect spares. */
export interface DisconnectOptions {
	/**
	 * A tag whose sockets stay, and go on being let in: the credential that
	 * replaced the ones withdrawn, where `tag` names their holder.
	 */
	except?: string;
	/**
	 * Which version of `except` this is, where credentials are numbered: of two
	 * disconnects of one tag, the one that spares the higher version stands,
	 * whichever reaches the object last.
	 */
	version?: number;
}

/** A grant as the object holds it. */
export interface HeldGrant {
	hear: string[];
	enter: string[];
	tags: string[];
}

/** The runtime allows a socket ten tags of 256 characters; one is its client's. */
export const MAX_GRANT_TAGS = 9;
/** Leaves room for the prefix that keeps a grant's tags apart from a client's. */
export const MAX_GRANT_TAG_LENGTH = 240;
/**
 * A grant lives in its socket's attachment, which the runtime holds to 16 KiB
 * with the socket's channels and presence beside it.
 */
export const MAX_GRANT_CHANNELS_LENGTH = 4096;

/** Whether `channel` is one of `patterns`, or under one that ends `*`. */
export function allows(patterns: readonly string[], channel: string): boolean {
	return patterns.some((pattern) =>
		pattern.endsWith('*') ? channel.startsWith(pattern.slice(0, -1)) : channel === pattern,
	);
}

const isStrings = (value: unknown): value is string[] =>
	Array.isArray(value) && value.every((entry) => typeof entry === 'string' && entry.length > 0);

/**
 * The grant the object will hold, or a `TypeError` naming what is wrong with
 * it. A grant is the app's own code speaking, so a bad one is a defect to throw
 * at, never a caller to refuse.
 */
export function holdGrant(grant: Grant): HeldGrant {
	if (typeof grant?.identity !== 'string' || grant.identity.length === 0)
		throw new TypeError('A grant names an identity.');
	const { hear, enter = [], tags = [] } = grant;
	if (!isStrings(hear) || !isStrings(enter) || !isStrings(tags))
		throw new TypeError("A grant's hear, enter and tags are lists of names.");
	if (tags.length > MAX_GRANT_TAGS)
		throw new TypeError(`A grant carries at most ${MAX_GRANT_TAGS} tags.`);
	if (tags.some((tag) => tag.length > MAX_GRANT_TAG_LENGTH))
		throw new TypeError(`A grant's tag is at most ${MAX_GRANT_TAG_LENGTH} characters.`);
	if ([...hear, ...enter].join().length > MAX_GRANT_CHANNELS_LENGTH)
		throw new TypeError(
			`A grant's channels are at most ${MAX_GRANT_CHANNELS_LENGTH} characters together: name a prefix.`,
		);
	return { hear: [...hear], enter: [...enter], tags: [...new Set(tags)] };
}
