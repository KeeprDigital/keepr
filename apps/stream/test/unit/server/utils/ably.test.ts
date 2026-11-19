import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_REALTIME_MESSAGE_BYTES } from '~~/shared/types/messages';
import { eventRealtimeScope } from '~~/shared/utils/realtimeChannels';
import {
	installRealtimeObjectFake,
	REFUSAL_MESSAGE,
	setWorkerBindings,
} from '~~/test/helpers/realtimeObjectFake';
import { lastCallTo } from '@keepr/nuxt-layer/test/helpers/lastCallTo';
import { ErrorInfoShaped } from '@keepr/nuxt-layer/test/helpers/providerRefusal';

/** The failure line, selected by its own `message`: the size diagnostic logs beside it. */
function isPublishFailureLine(call: unknown[]): boolean {
	const [line] = call;
	return typeof line === 'string' && line.includes('"message":"realtime_publish_failed"');
}

/** The size diagnostic, told apart from the failure line the same way. */
function isOversizedLine(call: unknown[]): boolean {
	const [line] = call;
	return typeof line === 'string' && line.includes('"message":"realtime_publish_oversized"');
}

/** The failure line as it was written, for assertions about the text itself. */
function loggedLine(spy: ReturnType<typeof vi.spyOn>): string {
	const [line] = lastCallTo(spy, isPublishFailureLine);
	return line as string;
}

function loggedFields(spy: ReturnType<typeof vi.spyOn>) {
	return JSON.parse(loggedLine(spy));
}

class MockAblyRest {
	static callCount = 0;
	static lastKey: string | undefined;
	constructor(key: string) {
		MockAblyRest.callCount++;
		MockAblyRest.lastKey = key;
	}

	static reset() {
		MockAblyRest.callCount = 0;
		MockAblyRest.lastKey = undefined;
	}
}

vi.mock('ably', () => ({
	default: { Rest: MockAblyRest },
}));

// These cases are the Event channel's and a Screen command's. What a publish
// then tells the Screens is pinned over real SQL in
// `screenOutputPublication.sqlite.test.ts`.
vi.mock('~~/server/modules/screen-output-publication', () => ({
	publishToScreenOutputs: async () => {},
}));

vi.stubGlobal(
	'useRuntimeConfig',
	vi.fn(() => ({ ablyApiKey: 'test-key' })),
);
vi.stubGlobal('getHeader', vi.fn());

// Every publish goes by RPC to its Event's object, on the Worker's own binding
// (ADR-0137). The binding is what is faked.
const realtime = await installRealtimeObjectFake();

/** A Worker whose configuration binds no object. */
function withoutTheBinding() {
	setWorkerBindings({});
}

beforeEach(() => {
	vi.resetModules();
	realtime.reset();
	setWorkerBindings(realtime.env);
});

// ──────────────── getOriginConnectionId ────────────────

describe('getOriginConnectionId', () => {
	beforeEach(() => {
		vi.mocked(getHeader).mockReset();
	});

	it('extracts x-realtime-connection-id header', async () => {
		vi.mocked(getHeader).mockReturnValue('conn-abc-123');
		const { getOriginConnectionId } = await import('~~/server/utils/ably');
		const mockEvent = {} as any;
		expect(getOriginConnectionId(mockEvent)).toBe('conn-abc-123');
		expect(getHeader).toHaveBeenCalledWith(mockEvent, 'x-realtime-connection-id');
	});

	it('accepts the id a page makes itself, and the shapes Ably issues', async () => {
		// A page on the object names itself with 32 hex characters. Ably's connection
		// ids are base64url-style tokens; its connection keys carry `!`.
		const { getOriginConnectionId } = await import('~~/server/utils/ably');
		for (const id of [
			'0f1e2d3c4b5a69788796a5b4c3d2e1f0',
			'veTb7EJgYVFI7g',
			'cf80Ju!xxxx-yyyy_zzzz',
			'a',
		]) {
			vi.mocked(getHeader).mockReturnValue(id);
			expect(getOriginConnectionId({} as any)).toBe(id);
		}
	});

	// The header is client-supplied and reaches the echo filter and every publish, so
	// only an id a page could have named itself by is relayed.
	it('ignores an oversized connection id instead of relaying it', async () => {
		vi.mocked(getHeader).mockReturnValue('a'.repeat(65));
		const { getOriginConnectionId } = await import('~~/server/utils/ably');
		expect(getOriginConnectionId({} as any)).toBeUndefined();
	});

	it('accepts an id at exactly the length bound', async () => {
		vi.mocked(getHeader).mockReturnValue('a'.repeat(64));
		const { getOriginConnectionId } = await import('~~/server/utils/ably');
		expect(getOriginConnectionId({} as any)).toBe('a'.repeat(64));
	});

	it('ignores a malformed connection id instead of relaying it', async () => {
		const { getOriginConnectionId } = await import('~~/server/utils/ably');
		for (const malformed of [
			'has spaces',
			'json{"a":1}',
			'line\nbreak',
			'quote"d',
			'<script>',
			'né',
		]) {
			vi.mocked(getHeader).mockReturnValue(malformed);
			expect(getOriginConnectionId({} as any)).toBeUndefined();
		}
	});

	it('treats an absent or empty header as no origin', async () => {
		const { getOriginConnectionId } = await import('~~/server/utils/ably');
		vi.mocked(getHeader).mockReturnValue(undefined as any);
		expect(getOriginConnectionId({} as any)).toBeUndefined();
		vi.mocked(getHeader).mockReturnValue('');
		expect(getOriginConnectionId({} as any)).toBeUndefined();
	});
});

// ──────────────── getAblyClient ────────────────

// The token route's alone, until the pages leave Ably: nothing publishes through it.
describe('getAblyClient', () => {
	beforeEach(() => {
		MockAblyRest.reset();
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: 'test-key' } as any);
	});

	it('returns Ably.Rest instance when configured', async () => {
		const { getAblyClient } = await import('~~/server/utils/ably');
		const client = getAblyClient();
		expect(MockAblyRest.lastKey).toBe('test-key');
		expect(client).toBeInstanceOf(MockAblyRest);
	});

	it('returns same instance on subsequent calls', async () => {
		const { getAblyClient } = await import('~~/server/utils/ably');
		const client1 = getAblyClient();
		const client2 = getAblyClient();
		expect(client1).toBe(client2);
		expect(MockAblyRest.callCount).toBe(1);
	});

	it('names the setting when no key is configured', async () => {
		vi.mocked(useRuntimeConfig).mockReturnValue({ ablyApiKey: '' } as any);
		const { getAblyClient } = await import('~~/server/utils/ably');
		const { ServiceConfigurationError } = await import('@keepr/nuxt-layer/server/utils/errors');

		const failure = (() => {
			try {
				return getAblyClient();
			} catch (error) {
				return error;
			}
		})() as InstanceType<typeof ServiceConfigurationError>;

		expect(failure).toBeInstanceOf(ServiceConfigurationError);
		expect(failure.message).toBe('NUXT_ABLY_API_KEY is not configured');
		expect(failure.statusCode).toBe(503);
	});
});

// ──────────────── publishMessage ────────────────

describe('publishMessage', () => {
	// A page's transport hands a handler the delivery's data as the message, under
	// the delivery's name, and its echo filter reads the origin inside it.
	it("publishes the message whole, under its type, on the Event's channel of the Event's object", async () => {
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(realtime.calls).toEqual([
			{
				scope: eventRealtimeScope(7),
				deliveries: [
					{
						channel: 'event:7',
						name: 'event:deleted',
						data: { eventId: 7, timestamp: expect.any(Number), originConnectionId: 'conn-123' },
					},
				],
			},
		]);
	});

	// The RPC refuses a whole call over a value it cannot carry, which JSON leaves out.
	it('publishes a message as JSON carries it', async () => {
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7, render: () => {} } as never);

		expect(realtime.on('event:7')).toEqual([
			{ channel: 'event:7', type: 'event:deleted', payload: {} },
		]);
	});

	it('publishes each Event to an object of its own', async () => {
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 });
		await publishMessage(8, 'event:deleted', { eventId: 8 });

		expect(realtime.calls.map(({ scope }) => scope)).toEqual([
			eventRealtimeScope(7),
			eventRealtimeScope(8),
		]);
		expect(eventRealtimeScope(7)).not.toBe(eventRealtimeScope(8));
	});

	it('does not turn a Worker with no binding for the object into a command failure', async () => {
		withoutTheBinding();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await expect(
			publishMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123'),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledOnce();
		expect(realtime.calls).toEqual([]);
		errorSpy.mockRestore();
	});

	it('preserves a missing binding as a failure for strict publications', async () => {
		// The strict path's contract is that the caller hears about it, as it was thrown.
		withoutTheBinding();
		const { publishMessageStrict } = await import('~~/server/utils/ably');

		await expect(
			publishMessageStrict(1, 'melee:playersSynced', { playerCount: 2 }, 'conn-123'),
		).rejects.toThrow('The Worker has no REALTIME binding');
	});
});

// ──────────────── the failed-publish diagnosis ────────────────

// `publishMessage` swallows a failed publish, so its log line is the only witness: it
// names why, keeps everything else out, and still swallows (#253).
describe('failed realtime publishes', () => {
	it('names why the object did not take the publish', async () => {
		realtime.refuse('event:7');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toEqual({
			message: 'realtime_publish_failed',
			eventId: 7,
			messageType: 'event:deleted',
			statusCode: null,
			errorCode: null,
			errorName: 'Error',
			reason: REFUSAL_MESSAGE,
		});
		errorSpy.mockRestore();
	});

	it('names the status and code of a failure that carries them', async () => {
		realtime.refuse('event:7', 2, new ErrorInfoShaped('No application found', 40400, 404));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toMatchObject({ statusCode: 404, errorCode: 40400 });
		errorSpy.mockRestore();
	});

	it('still swallows the failure, because the route has no local effect to report', async () => {
		realtime.refuse('event:7');
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await expect(
			publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123'),
		).resolves.toBeUndefined();

		expect(errorSpy).toHaveBeenCalledOnce();
		expect(realtime.published).toEqual([]);
		errorSpy.mockRestore();
	});

	it('leaves the strict path free to propagate the same rejection', async () => {
		const failure = new Error('The object is overloaded');
		realtime.refuse('event:7', 2, failure);
		const { publishMessageStrict } = await import('~~/server/utils/ably');

		await expect(
			publishMessageStrict(7, 'melee:playersSynced', { playerCount: 2 }, 'conn-123'),
		).rejects.toBe(failure);
	});

	it('says the binding was missing rather than only that a publish failed', async () => {
		// Told apart from the object's own failure by its `reason`, which names the binding.
		withoutTheBinding();
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		expect(loggedFields(errorSpy)).toMatchObject({
			errorName: 'Error',
			reason: expect.stringContaining('The Worker has no REALTIME binding'),
		});
		errorSpy.mockRestore();
	});

	it('bounds the reason, because a failure may put anything in its message', async () => {
		realtime.refuse('event:7', 2, new Error(`No application found ${'x'.repeat(5000)}`));
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');
		const { MAX_PUBLISH_FAILURE_REASON_CHARS } =
			await import('~~/server/utils/realtimePublishFailure');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		const { reason } = loggedFields(errorSpy);
		expect(reason).toHaveLength(MAX_PUBLISH_FAILURE_REASON_CHARS);
		expect(reason.startsWith('No application found')).toBe(true);
		errorSpy.mockRestore();
	});

	it('keeps whatever else a failure carries out of the log', async () => {
		// The fields are chosen, not copied: anything else on the error can retain
		// request context, and none of it is named.
		const withMetadata = new ErrorInfoShaped('No application found', 40400, 404);
		withMetadata.href = 'https://help.example/error/40400';
		withMetadata.detail = { key: 'appId.keyId:secret-that-must-not-be-logged' };
		realtime.refuse('event:7', 2, withMetadata);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123');

		const line = loggedLine(errorSpy);
		expect(line).not.toContain('secret-that-must-not-be-logged');
		expect(line).not.toContain('help.example');
		expect(Object.keys(loggedFields(errorSpy))).toEqual([
			'message',
			'eventId',
			'messageType',
			'statusCode',
			'errorCode',
			'errorName',
			'reason',
		]);
		errorSpy.mockRestore();
	});

	it('does not let a hostile error shape turn a swallowed failure into a real one', async () => {
		// The catch block is the last line of defence; if reading the error throws,
		// the swallow becomes a 500 on a route whose write already committed.
		const hostile = new Error('unreadable');
		Object.defineProperty(hostile, 'statusCode', {
			get() {
				throw new Error('property access refused');
			},
		});
		realtime.refuse('event:7', 2, hostile);
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await expect(
			publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123'),
		).resolves.toBeUndefined();

		expect(loggedFields(errorSpy)).toMatchObject({
			message: 'realtime_publish_failed',
			eventId: 7,
			statusCode: null,
			errorCode: null,
		});
		errorSpy.mockRestore();
	});
});

// ──────────────── the second attempt ────────────────

// An object being reset fails the call that meets it and answers the next, so a
// publish on the Event's channel is made once more, on a stub of its own. A
// repeat is safe there: a message announces, and a read is the authority.
describe("a publish on the Event's channel whose call fails", () => {
	const HELPERS = [
		{ helper: 'publishMessage', strict: false },
		{ helper: 'publishMessageStrict', strict: true },
	];

	async function publish(strict: boolean) {
		const { publishMessage, publishMessageStrict } = await import('~~/server/utils/ably');
		return await (
			strict
				? publishMessageStrict(7, 'melee:playersSynced', { playerCount: 2 }, 'conn-123')
				: publishMessage(7, 'event:deleted', { eventId: 7 }, 'conn-123')
		).then(
			() => 'resolved',
			(error: unknown) => error,
		);
	}

	function loggedFailures(spy: ReturnType<typeof vi.spyOn>) {
		return spy.mock.calls.filter(isPublishFailureLine).map(([line]) => JSON.parse(line as string));
	}

	it.each(HELPERS)(
		'is delivered by $helper on the second, and nothing is logged as failed',
		async ({ strict }) => {
			realtime.refuse('event:7', 1);
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			expect(await publish(strict)).toBe('resolved');

			expect(realtime.on('event:7')).toHaveLength(1);
			expect(errorSpy).not.toHaveBeenCalled();
		},
	);

	// Refused twice and no more: a third attempt would be answered, and deliver.
	it.each(HELPERS)(
		'is attempted twice by $helper and never a third time, then fails as it does',
		async ({ strict }) => {
			const second = new Error('The object is overloaded');
			realtime.refuse('event:7', 1, new Error('The object is being reset'));
			realtime.refuse('event:7', 1, second);
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			const outcome = await publish(strict);

			expect(realtime.calls).toHaveLength(2);
			expect(realtime.published).toEqual([]);
			expect(outcome).toBe(strict ? second : 'resolved');
			expect(loggedFailures(errorSpy)).toEqual(
				strict
					? []
					: [
							{
								message: 'realtime_publish_failed',
								eventId: 7,
								messageType: 'event:deleted',
								statusCode: null,
								errorCode: null,
								errorName: 'Error',
								reason: second.message,
							},
						],
			);
		},
	);
});

// ──────────────── the oversized-message diagnostic ────────────────

// A message over 64 KiB is reported, never refused: the write it announces has
// already committed (ADR-0004, #95).
describe('oversized realtime messages', () => {
	function oversizedPayload() {
		// One field over the bound, so the assertion is about the threshold rather
		// than about any particular message type's shape.
		return {
			eventId: 1,
			reason: 'x'.repeat(MAX_REALTIME_MESSAGE_BYTES),
		} as never;
	}

	/** Every line the spy recorded, parsed — for the assertion about the whole list. */
	function loggedMessages(spy: ReturnType<typeof vi.spyOn>) {
		return spy.mock.calls.map(([entry]: unknown[]) => JSON.parse(entry as string));
	}

	/** The oversize line, selected by name so a run that logged nothing fails readably. */
	function oversizedFields(spy: ReturnType<typeof vi.spyOn>) {
		const [line] = lastCallTo(spy, isOversizedLine);
		return JSON.parse(line as string);
	}

	it('reports the size and the limit, and still publishes', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(1, 'event:deleted', oversizedPayload(), 'conn-123');

		expect(loggedMessages(errorSpy)).toEqual([
			{
				message: 'realtime_publish_oversized',
				eventId: 1,
				messageType: 'event:deleted',
				bytes: expect.any(Number),
				limit: MAX_REALTIME_MESSAGE_BYTES,
			},
		]);
		expect(oversizedFields(errorSpy).bytes).toBeGreaterThan(MAX_REALTIME_MESSAGE_BYTES);
		// Reported, not refused: the write has committed.
		expect(realtime.on('event:1')).toHaveLength(1);
		errorSpy.mockRestore();
	});

	it('says nothing about a message inside the limit', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessage } = await import('~~/server/utils/ably');

		await publishMessage(1, 'event:deleted', { eventId: 1 }, 'conn-123');

		expect(errorSpy).not.toHaveBeenCalled();
		expect(realtime.on('event:1')).toHaveLength(1);
		errorSpy.mockRestore();
	});

	it('reports on the strict publication path too, which is where a sync failure surfaces', async () => {
		const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { publishMessageStrict } = await import('~~/server/utils/ably');

		await publishMessageStrict(1, 'melee:dataReset', oversizedPayload(), 'conn-123');

		expect(oversizedFields(errorSpy)).toMatchObject({
			message: 'realtime_publish_oversized',
			messageType: 'melee:dataReset',
		});
		expect(realtime.on('event:1')).toHaveLength(1);
		errorSpy.mockRestore();
	});
});

// ──────────────── publishScreenCommand ────────────────

describe('publishScreenCommand', () => {
	it("publishes a Screen command on the Screen's channel of its Event's object", async () => {
		const { publishScreenCommand } = await import('~~/server/utils/ably');

		await publishScreenCommand(1, 10, 'identify');

		expect(realtime.calls).toEqual([
			{
				scope: eventRealtimeScope(1),
				deliveries: [
					{
						channel: 'screen:1:10',
						name: 'screen:command:identify',
						data: { eventId: 1, screenId: 10, timestamp: expect.any(Number) },
					},
				],
			},
		]);
	});

	// A failed publish leaves as this server's failure, not with a status of its
	// own that h3 would adopt as the route's answer (#264).
	describe('when the publish fails', () => {
		it("propagates a named server-side failure instead of the failure's own status", async () => {
			realtime.refuse('screen:1:10', 1, new ErrorInfoShaped('No application found', 40400, 404));
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');
			const { REALTIME_PUBLISH_FAILED_MESSAGE, RealtimePublishError } =
				await import('~~/server/utils/realtimePublishFailure');

			const failure = await publishScreenCommand(1, 10, 'identify').then(
				() => null,
				(error) => error,
			);

			expect(failure).toBeInstanceOf(RealtimePublishError);
			expect(failure.statusCode).toBe(502);
			expect(failure.message).toBe(REALTIME_PUBLISH_FAILED_MESSAGE);
			errorSpy.mockRestore();
		});

		it("carries the failure's numeric code, when it has one, for the request's log line", async () => {
			realtime.refuse('screen:1:10', 1, new ErrorInfoShaped('No application found', 40400, 404));
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');

			const failure = await publishScreenCommand(1, 10, 'identify').then(
				() => null,
				(error) => error,
			);

			expect(failure.code).toBe(40400);
			errorSpy.mockRestore();
		});

		it("keeps the failure's own account of itself in the log", async () => {
			// The same field set the swallowing path emits (#253), for the same
			// reason: the response is not allowed to carry the failure's text, so
			// this line is the only place it is ever said.
			realtime.refuse('screen:1:10');
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');

			await publishScreenCommand(1, 10, 'identify').catch(() => {});

			expect(loggedFields(errorSpy)).toEqual({
				message: 'realtime_publish_failed',
				eventId: 1,
				screenId: 10,
				messageType: 'screen:command:identify',
				statusCode: null,
				errorCode: null,
				errorName: 'Error',
				reason: REFUSAL_MESSAGE,
			});
			errorSpy.mockRestore();
		});

		it('keeps the throw it wrapped, so nothing about the failure is lost', async () => {
			const refusal = new Error('The object is overloaded');
			realtime.refuse('screen:1:10', 1, refusal);
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');

			const failure = await publishScreenCommand(1, 10, 'identify').then(
				() => null,
				(error) => error,
			);

			expect(failure.cause).toBe(refusal);
			errorSpy.mockRestore();
		});

		// A command is done each time it is heard, and `debug` turns a panel on or
		// off: sent again, one the first call did deliver would be undone.
		it('is not sent a second time, where an Event message would be', async () => {
			realtime.refuse('screen:1:10', 1);
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');
			const { RealtimePublishError } = await import('~~/server/utils/realtimePublishFailure');

			await expect(publishScreenCommand(1, 10, 'debug')).rejects.toBeInstanceOf(
				RealtimePublishError,
			);

			expect(realtime.calls).toHaveLength(1);
			expect(realtime.published).toEqual([]);
			errorSpy.mockRestore();
		});

		// No setting produces a Worker without the binding, so it is no
		// configuration failure: the command was not delivered, and the log says why.
		it('answers a Worker with no binding for the object the same way, and logs the binding', async () => {
			withoutTheBinding();
			const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { publishScreenCommand } = await import('~~/server/utils/ably');
			const { RealtimePublishError } = await import('~~/server/utils/realtimePublishFailure');

			const failure = await publishScreenCommand(1, 10, 'identify').then(
				() => null,
				(error) => error,
			);

			expect(failure).toBeInstanceOf(RealtimePublishError);
			expect(failure.statusCode).toBe(502);
			expect(loggedFields(errorSpy).reason).toContain('The Worker has no REALTIME binding');
			errorSpy.mockRestore();
		});
	});
});
