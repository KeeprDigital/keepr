import type { StandInPersona } from '@keepr/accounts-stand-in/standIn';
import type { H3Event } from 'h3';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createAccountsStandIn, standInCookie } from '@keepr/accounts-stand-in/standIn';
import { createError, createEvent, getRequestURL } from 'h3';
import { vi } from 'vitest';

/**
 * Keepr Accounts as a Worker's `KEEPR_ACCOUNTS` binding reaches it, for a unit
 * test of code that asks who a request belongs to. The Accounts Stand-in
 * answers, as it does for a whole local server, so the Identity Proof is a real
 * one the layer verifies: only the Worker-to-Worker connection is faked.
 */

/** Who a test's request asks as: a User the stand-in names, or nobody. */
export type Asker = StandInPersona | 'signed-out';

export const SIGNED_OUT: Asker = 'signed-out';
/** A User with App access to Stream Keepr and no more: an operator. */
export const A_MEMBER: Asker = { user: 'ada', name: 'Ada', apps: { stream: 'member' } };
/** A Graphics Administrator. */
export const AN_ADMINISTRATOR: Asker = { user: 'grace', name: 'Grace', apps: { stream: 'admin' } };
/** A signed-in User with no App access to Stream Keepr. */
export const AN_OUTSIDER: Asker = { user: 'eve', name: 'Eve', apps: { stream: null } };

export interface KeeprAccountsBinding {
	fetch: (input: string, init?: RequestInit) => Promise<Response>;
	/** Each path Keepr Accounts was asked, in order: empty while nobody asked who a request belongs to. */
	asked: string[];
}

/** The binding, answered by one Accounts Stand-in for as long as the test file runs. */
export function keeprAccountsBinding(): KeeprAccountsBinding {
	const standIn = createAccountsStandIn();
	const asked: string[] = [];
	return {
		asked,
		async fetch(input, init) {
			asked.push(new URL(input).pathname);
			return await standIn.fetch(new Request(input, init));
		},
	};
}

/**
 * A request as the Worker receives it: a real H3 event with its bindings,
 * carrying the cookie that names who asks. `env` replaces the bindings, for a
 * Worker with none or with a Keepr Accounts that does not answer.
 */
export function workerRequest({
	as,
	path = '/api/events',
	method = 'GET',
	headers = {},
	env,
}: {
	as: Asker;
	path?: string;
	method?: string;
	headers?: Record<string, string>;
	env: Record<string, unknown>;
}): H3Event {
	const request = new IncomingMessage(new Socket());
	request.url = path;
	request.method = method;
	request.headers = { host: 'stream.example', cookie: standInCookie(as), ...headers };
	const event = createEvent(request, new ServerResponse(request));
	event.context.cloudflare = { env } as never;
	return event;
}

/** The h3 names Nitro auto-imports into server code, as the real ones. */
export function stubServerGlobals() {
	vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
	vi.stubGlobal('getRequestURL', getRequestURL);
	vi.stubGlobal('createError', createError);
}
