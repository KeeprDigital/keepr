import { describe, expect, it } from 'vitest';
import { TICKET_HEADER } from '../../src/object/handOff.ts';
import { handSocket, portRequest, readPortAnswer } from '../server/worker/handOff.ts';
import type { ScopeNamespace } from '../server/worker/handOff.ts';
import { HAND_OFF_HEADER, PORT_ANSWER_HEADER } from '../server/worker/headers.ts';

const PORT_PATH = '/realtime/port';

/** An upgrade as a browser sends it, with what else a caller chose to send. */
const upgrade = (headers: Record<string, string> = {}): Request =>
	new Request('https://app.example/realtime/socket?room=1&client=c', {
		headers: {
			upgrade: 'websocket',
			connection: 'Upgrade',
			'sec-websocket-key': 'key',
			'sec-websocket-version': '13',
			cookie: 'caller=ada',
			origin: 'https://app.example',
			...headers,
		},
	});

/** The port's own answer, as `defineRealtimePort` sends it. */
const answer = (admission: unknown): Response =>
	Response.json({ admission }, { headers: { [PORT_ANSWER_HEADER]: '1' } });

describe('the request the port is asked with', () => {
	it("is a GET of the port's path with the socket's query and the caller's own headers", () => {
		const asked = portRequest(upgrade(), PORT_PATH);

		expect(asked.method).toBe('GET');
		expect(asked.url).toBe('https://app.example/realtime/port?room=1&client=c');
		expect(asked.headers.get('cookie')).toBe('caller=ada');
		expect(asked.headers.get('origin')).toBe('https://app.example');
	});

	// Nothing of the upgrade goes, and nothing the hand-off itself reads.
	it.each(['upgrade', 'connection', 'sec-websocket-key', TICKET_HEADER, HAND_OFF_HEADER])(
		'carries no %s',
		(name) => {
			const asked = portRequest(
				upgrade({ [TICKET_HEADER]: 'f', [HAND_OFF_HEADER]: 'f' }),
				PORT_PATH,
			);

			expect(asked.headers.has(name)).toBe(false);
		},
	);
});

describe("the port's answer", () => {
	it.each([
		{ said: 'an admission', admission: { scope: 's', grant: { identity: 'i', hear: [] } } },
		{ said: 'a refusal', admission: null },
	])('is read from the port when it gives $said', async ({ admission }) => {
		const read = await readPortAnswer(answer(admission), PORT_PATH);

		expect(read).toEqual({ admission });
	});

	// An app that refuses by status is refusing, and a page must read it as such.
	it.each([401, 403])('is a refusal when the app answers %i', async (status) => {
		const read = await readPortAnswer(new Response('no', { status }), PORT_PATH);

		expect(read).toEqual({ admission: null });
	});

	it("is the app's own when it fails otherwise", async () => {
		const failed = new Response('down', { status: 503 });

		expect(await readPortAnswer(failed, PORT_PATH)).toEqual({ response: failed });
	});

	it.each([
		{ what: 'without the port header', response: new Response('a page') },
		{
			what: 'with the header and a body that is no answer',
			response: new Response('<html>', { headers: { [PORT_ANSWER_HEADER]: '1' } }),
		},
	])('is a clear error when the app answers $what', async ({ response }) => {
		const read = await readPortAnswer(response, PORT_PATH);

		expect('response' in read && read.response.status).toBe(500);
		expect('response' in read && (await read.response.text())).toMatch(/defineRealtimePort/);
	});
});

describe('the hand-off', () => {
	it('names the binding it was not given', async () => {
		const answered = await handSocket(upgrade(), {
			namespace: undefined as unknown as ScopeNamespace,
			binding: 'REALTIME',
			portPath: PORT_PATH,
			ask: async () => answer({ scope: 's', grant: { identity: 'i', hear: [] } }),
		});

		expect(answered.status).toBe(500);
		expect(await answered.text()).toMatch(/REALTIME/);
	});
});
