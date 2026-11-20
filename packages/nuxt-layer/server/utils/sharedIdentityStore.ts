import type { JSONWebKeySet } from 'jose';
import type { AppId } from '../../shared/utils/appRegistry';

/**
 * Where every isolate of one Worker shares what its identity resolver has
 * verified, so one isolate's ask of Keepr Accounts answers the others (ADR-0150,
 * in the root `docs/adr`). It holds text under a URL, for no longer than it is
 * told. Any call may fail or never answer: the resolver then does without it.
 */
export interface SharedStore {
	get: (url: string) => Promise<string | undefined>;
	put: (url: string, value: string, ttlSeconds: number) => Promise<void>;
	delete: (url: string) => Promise<void>;
}

/** The part of a Worker's Cache API this reads: a named cache, keyed by URL. */
interface WorkersCache {
	match: (url: string) => Promise<Response | undefined>;
	put: (url: string, response: Response) => Promise<void>;
	delete: (url: string) => Promise<boolean>;
}

/**
 * Its own cache, not `caches.default`, which `fetch` reads through: a record
 * kept under the Installation's origin answers no request to that origin.
 */
const CACHE_NAME = 'keepr-identity';

/**
 * The Worker's Cache API, as a shared store: per data centre, with no binding,
 * on an Installation's custom domain and in local workerd. `undefined` where
 * there is none, as under Node; on `*.workers.dev` it stores nothing, and the
 * resolver finds nothing in it.
 */
export function workersCacheStore(): SharedStore | undefined {
	const storage = (globalThis as { caches?: { open?: (name: string) => Promise<WorkersCache> } })
		.caches;
	const open = storage?.open?.bind(storage);
	if (!open) return undefined;
	// Opened on first use, inside a request: a Worker does no I/O at global scope.
	let opened: Promise<WorkersCache> | undefined;
	const cache = () =>
		(opened ??= open(CACHE_NAME).catch((error: unknown) => {
			opened = undefined;
			throw error;
		}));
	return {
		async get(url) {
			const hit = await (await cache()).match(url);
			return hit ? await hit.text() : undefined;
		},
		async put(url, value, ttlSeconds) {
			await (
				await cache()
			).put(url, new Response(value, { headers: { 'cache-control': `max-age=${ttlSeconds}` } }));
		},
		async delete(url) {
			await (await cache()).delete(url);
		},
	};
}

/**
 * What a Session's shared record holds: its Identity Proof as Keepr Accounts
 * signed it, never what it was read as, and the cookies a refresh of it renewed
 * that no browser has been sent yet.
 */
export interface SharedProofRecord {
	token: string;
	renewedCookies: string[];
}

/** Keepr Accounts' keys as an isolate fetched them, and when, in ms since the epoch. */
export interface SharedKeysRecord {
	keys: unknown;
	fetchedAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** SHA-256 of the cookie for one purpose: the record's key and its sealing key are never the same hash. */
async function cookieDigest(purpose: 'key' | 'seal', app: AppId, cookie: string) {
	return new Uint8Array(
		await crypto.subtle.digest(
			'SHA-256',
			encoder.encode(`keepr-identity\0${purpose}\0${app}\0${cookie}`),
		),
	);
}

const hex = (bytes: Uint8Array) =>
	Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const toBase64 = (bytes: Uint8Array) =>
	btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

const IV_BYTES = 12;

function isRecord(value: unknown): value is SharedProofRecord {
	const record = value as Partial<SharedProofRecord> | null;
	return (
		typeof record?.token === 'string' &&
		Array.isArray(record.renewedCookies) &&
		record.renewedCookies.every((cookie) => typeof cookie === 'string')
	);
}

/**
 * One App's records in a shared store, under the origin the Worker was reached
 * on: an Installation's own, so records under one origin are never read under
 * another. `undefined` for an origin that is not http or https, which shares
 * nothing.
 *
 * A Session's record is kept under a hash of its cookie, never the cookie, and
 * sealed (AES-GCM) with a key only that same cookie derives, bound to the slot
 * it is kept in: it opens for the request that carries the cookie it was
 * written for, and for no other. What opens is still only a token, which the
 * resolver verifies before it answers. Keepr Accounts' keys are public, and
 * kept as published.
 */
export function sharedIdentityRecords(store: SharedStore, app: AppId, origin: string) {
	let base: string;
	try {
		const url = new URL(origin);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
		base = url.origin;
	} catch {
		return undefined;
	}
	const at = (key: string) => `${base}/${key}`;

	async function slot(cookie: string) {
		const key = `${app}/proof/${hex(await cookieDigest('key', app, cookie))}`;
		const sealKey = await crypto.subtle.importKey(
			'raw',
			await cookieDigest('seal', app, cookie),
			'AES-GCM',
			false,
			['encrypt', 'decrypt'],
		);
		return { key, sealKey, additionalData: encoder.encode(key) };
	}

	return {
		/** The record kept for `cookie`; `undefined` when there is none, or one that does not open for it. */
		async readProof(cookie: string): Promise<SharedProofRecord | undefined> {
			const { key, sealKey, additionalData } = await slot(cookie);
			const sealed = await store.get(at(key));
			if (sealed === undefined) return undefined;
			try {
				const bytes = fromBase64(sealed);
				const opened = await crypto.subtle.decrypt(
					{ name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData },
					sealKey,
					bytes.slice(IV_BYTES),
				);
				const record: unknown = JSON.parse(decoder.decode(opened));
				return isRecord(record) ? record : undefined;
			} catch {
				return undefined;
			}
		},
		async writeProof(cookie: string, record: SharedProofRecord, ttlSeconds: number) {
			const { key, sealKey, additionalData } = await slot(cookie);
			const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
			const sealed = new Uint8Array(
				await crypto.subtle.encrypt(
					{ name: 'AES-GCM', iv, additionalData },
					sealKey,
					encoder.encode(JSON.stringify(record)),
				),
			);
			const bytes = new Uint8Array(IV_BYTES + sealed.length);
			bytes.set(iv);
			bytes.set(sealed, IV_BYTES);
			await store.put(at(key), toBase64(bytes), ttlSeconds);
		},
		async removeProof(cookie: string) {
			await store.delete(at((await slot(cookie)).key));
		},
		/**
		 * Keepr Accounts' keys as another isolate last fetched them, and when, or
		 * `undefined`. The keys are unchecked: the caller reads them as a key set.
		 */
		async readKeys(): Promise<SharedKeysRecord | undefined> {
			const kept = await store.get(at(`${app}/keys`));
			if (kept === undefined) return undefined;
			const record = JSON.parse(kept) as Partial<SharedKeysRecord> | null;
			return typeof record?.fetchedAt === 'number' ? (record as SharedKeysRecord) : undefined;
		},
		async writeKeys(keys: JSONWebKeySet, fetchedAt: number, ttlSeconds: number) {
			await store.put(
				at(`${app}/keys`),
				JSON.stringify({ keys, fetchedAt } satisfies SharedKeysRecord),
				ttlSeconds,
			);
		},
	};
}

export type SharedIdentityRecords = NonNullable<ReturnType<typeof sharedIdentityRecords>>;
