/**
 * What Keepr Accounts tells an App of a User other than the one asking: their
 * name, by id, and nothing else (ADR-0145). Keepr Accounts answers it and the
 * layer's `readUserNames` asks it, so both read this one shape.
 */

/** Keepr Accounts' "User ids in, names out" path. */
export const USER_NAMES_PATH = '/api/users/names';

/** The query parameter a User id is asked by, once for each id. */
export const USER_NAMES_ID_PARAMETER = 'id';

/**
 * How many User ids one request asks about: what bounds the work of one
 * question. An App with more to ask about asks again.
 */
export const USER_NAMES_MAX_IDS = 50;

/**
 * Keepr Accounts' answer: the name of each User asked about that the asker may
 * be told. An id left out is unnamed, and the answer never says why.
 */
export interface UserNamesAnswer {
	names: Record<string, string>;
}

/** The path and query that asks Keepr Accounts for the names of `ids`. */
export function userNamesAddress(ids: readonly string[]): string {
	const query = new URLSearchParams(ids.map((id) => [USER_NAMES_ID_PARAMETER, id]));
	return `${USER_NAMES_PATH}?${query.toString()}`;
}

/** The User ids a request to `USER_NAMES_PATH` asks about, each once, blank ones dropped. */
export function askedUserIds(address: URL): string[] {
	return [...new Set(address.searchParams.getAll(USER_NAMES_ID_PARAMETER))].filter(
		(id) => id.length > 0,
	);
}
