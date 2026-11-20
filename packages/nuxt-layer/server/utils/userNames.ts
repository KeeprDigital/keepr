import type { H3Event } from 'h3';
import type { AccountsConnection } from './requestIdentity';
import { getRequestHeader } from 'h3';
import {
	IDENTITY_PROOF_LIFETIME_SECONDS,
	KEEPR_ACCOUNTS_ORIGIN,
} from '../../shared/utils/identityProof';
import { USER_NAMES_MAX_IDS, userNamesAddress } from '../../shared/utils/userNames';
import { accountsConnectionOf } from './requestIdentity';

/**
 * What to call a User other than the one a request belongs to, asked of Keepr
 * Accounts over the Worker-to-Worker connection with the request's own cookie
 * (ADR-0145). Keepr Accounts decides whose names that Session is told; an App
 * holds no Users, and sends no credential of its own.
 *
 * It answers what it could learn and never refuses: a page that shows who did
 * something still reads, with ids, while Keepr Accounts cannot be asked, or is
 * a Release that has no such route yet.
 */

/** What Keepr Accounts said of one id to one cookie: a name, or that it gave none. */
interface KeptAnswer {
	name: string | null;
	until: number;
}

/** The name in `names` for `id`, when it is one: text that is not blank. */
function nameIn(names: Record<string, unknown>, id: string): string | null {
	const name = Object.hasOwn(names, id) ? names[id] : undefined;
	return typeof name === 'string' && name.trim().length > 0 ? name : null;
}

function inGroupsOf<Item>(size: number, items: readonly Item[]): Item[][] {
	const groups: Item[][] = [];
	for (let start = 0; start < items.length; start += size)
		groups.push(items.slice(start, start + size));
	return groups;
}

/**
 * A reader of User names for one App, holding what Keepr Accounts has answered.
 *
 * An answer is kept for `lifetimeMs`, an Identity Proof's life unless told
 * otherwise, under the cookie it was given to: so a name is never shown to a
 * request Keepr Accounts did not give it to, and a User who stops sharing an
 * Organisation with the reader stops being named as soon as a disabled User
 * stops being admitted. "Unnamed" is kept as long, so an id no User has is not
 * asked about on every reading. A question that failed keeps nothing.
 */
export function createUserNameReader({
	lifetimeMs = IDENTITY_PROOF_LIFETIME_SECONDS * 1000,
	cacheSize = 5000,
	timeoutMs = 2000,
}: { lifetimeMs?: number; cacheSize?: number; timeoutMs?: number } = {}) {
	const kept = new Map<string, KeptAnswer>();
	// A cookie header holds no line break, so no two pairs share a key.
	const keyOf = (cookie: string, id: string) => `${cookie}\n${id}`;

	function keep(key: string, answer: KeptAnswer) {
		kept.delete(key);
		kept.set(key, answer);
		for (const oldest of kept.keys()) {
			if (kept.size <= cacheSize) break;
			kept.delete(oldest);
		}
	}

	/** One question of at most `USER_NAMES_MAX_IDS` ids, or `undefined` when it went unanswered. */
	async function ask(
		accounts: AccountsConnection,
		cookie: string,
		ids: readonly string[],
	): Promise<Record<string, unknown> | undefined> {
		const unanswered = (reason: string) => {
			console.warn(JSON.stringify({ message: 'user_names_unanswered', reason }));
			return undefined;
		};
		const abort = new AbortController();
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			const response = await Promise.race([
				accounts.fetch(`${KEEPR_ACCOUNTS_ORIGIN}${userNamesAddress(ids)}`, {
					headers: cookie ? { cookie } : {},
					signal: abort.signal,
				}),
				new Promise<undefined>((resolve) => {
					timer = setTimeout(() => resolve(undefined), timeoutMs);
				}),
			]);
			if (!response) {
				abort.abort();
				return unanswered(`Keepr Accounts did not answer within ${timeoutMs}ms`);
			}
			if (!response.ok) return unanswered(`Keepr Accounts answered ${response.status}`);
			const { names } = (await response.json()) as { names?: unknown };
			if (typeof names !== 'object' || names === null || Array.isArray(names))
				return unanswered('Keepr Accounts answered something other than names');
			return names as Record<string, unknown>;
		} catch (error) {
			return unanswered(`the question failed (${(error as Error).message})`);
		} finally {
			clearTimeout(timer);
		}
	}

	/** The name of each of `ids` that Keepr Accounts tells the request carrying `cookie`. */
	return async function read({
		cookie = '',
		accounts,
		ids,
	}: {
		cookie?: string | undefined;
		accounts: AccountsConnection;
		ids: Iterable<string>;
	}): Promise<Record<string, string>> {
		const now = Date.now();
		const names: Record<string, string> = {};
		const toAsk: string[] = [];
		for (const id of new Set(ids)) {
			if (id.length === 0) continue;
			const answer = kept.get(keyOf(cookie, id));
			if (!answer || now >= answer.until) toAsk.push(id);
			else if (answer.name !== null) names[id] = answer.name;
		}

		await Promise.all(
			inGroupsOf(USER_NAMES_MAX_IDS, toAsk).map(async (group) => {
				const answered = await ask(accounts, cookie, group);
				if (!answered) return;
				const until = Date.now() + lifetimeMs;
				for (const id of group) {
					const name = nameIn(answered, id);
					keep(keyOf(cookie, id), { name, until });
					if (name !== null) names[id] = name;
				}
			}),
		);
		return names;
	};
}

export type UserNameReader = ReturnType<typeof createUserNameReader>;

let reader: UserNameReader | undefined;

/**
 * The names Keepr Accounts tells this request of the Users `ids` name: those
 * who share an Organisation with the request's own User, and no others. An id
 * left out is unnamed, and its caller shows the id.
 *
 * An App calls it from a route that has already asked who the request belongs
 * to, and names that User from their Identity Proof without asking here.
 */
export async function readUserNames(
	event: H3Event,
	ids: Iterable<string>,
	read: UserNameReader = (reader ??= createUserNameReader()),
): Promise<Record<string, string>> {
	let accounts: AccountsConnection;
	try {
		accounts = accountsConnectionOf(event);
	} catch {
		// No binding: nobody could have been recognised either, and nothing is named.
		return {};
	}
	return await read({ cookie: getRequestHeader(event, 'cookie'), accounts, ids });
}
