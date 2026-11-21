import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal(
	'createError',
	(input: { statusCode: number; statusMessage: string; message: string }) =>
		Object.assign(new Error(input.message), input),
);

const mockGetRequestHeader = vi.fn();
const mockGetRequestWebStream = vi.fn();
const mockReadBody = vi.fn();
vi.stubGlobal('getRequestHeader', mockGetRequestHeader);
vi.stubGlobal('getRequestWebStream', mockGetRequestWebStream);
vi.stubGlobal('readBody', mockReadBody);

const {
	assertJsonPayloadSize,
	getBoundedRequestBodyStream,
	jsonPayloadByteLength,
	readJsonPayloadLimited,
} = await import('../../../../server/utils/payloadLimits');

function streamOf(...chunks: string[]) {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	});
}

/** `{"v":"…"}` is eight bytes around its value. */
const bodyOf = (bytes: number) => `{"v":"${'x'.repeat(bytes - 8)}"}`;

describe('a payload exactly at its bound', () => {
	beforeEach(() => {
		mockGetRequestHeader.mockReturnValue(null);
		mockGetRequestWebStream.mockReturnValue(undefined);
	});

	it.each([
		['a value of exactly the bound', 32, true],
		['one byte over', 33, false],
	])('accepts a persisted payload of %s only', (_label, bytes, accepted) => {
		const value = JSON.parse(bodyOf(bytes)) as unknown;
		const check = () => assertJsonPayloadSize(value, 32, 'Config');
		if (accepted) expect(check).not.toThrow();
		else expect(check).toThrowError(expect.objectContaining({ statusCode: 413 }));
	});

	it.each([
		['a declared length of exactly the bound', '32', bodyOf(32), true],
		['one byte over', '33', bodyOf(32), false],
		['a streamed body of exactly the bound', null, bodyOf(32), true],
		['a streamed body one byte over', null, bodyOf(33), false],
	])('reads %s only', async (_label, declared, body, accepted) => {
		mockGetRequestHeader.mockReturnValue(declared);
		mockGetRequestWebStream.mockReturnValue(streamOf(body.slice(0, 5), body.slice(5)));

		const read = readJsonPayloadLimited({} as any, 32, 'Config');
		if (accepted) await expect(read).resolves.toEqual(JSON.parse(body));
		else await expect(read).rejects.toMatchObject({ statusCode: 413 });
	});
});

describe('getBoundedRequestBodyStream', () => {
	const original = streamOf('original');
	const bounded = streamOf('bounded');

	it.each([
		['the middleware’s bounded stream', { _requestBody: bounded }, bounded],
		['the request’s own stream without one', {}, original],
		['the request’s own stream when the slot holds no stream', { _requestBody: '{}' }, original],
	])('answers %s', (_label, event, stream) => {
		mockGetRequestWebStream.mockReturnValue(original);
		expect(getBoundedRequestBodyStream(event as any)).toBe(stream);
	});
});

describe('json payload limits', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetRequestHeader.mockReturnValue(null);
		mockGetRequestWebStream.mockReturnValue(undefined);
	});

	it('counts encoded bytes rather than UTF-16 code units', () => {
		expect(jsonPayloadByteLength('😀')).toBe(6); // two JSON quotes plus four UTF-8 bytes
	});

	it('throws a 413 for oversized persisted payloads', () => {
		expect(() =>
			assertJsonPayloadSize(
				{
					value: 'x'.repeat(100),
				},
				16,
				'Config',
			),
		).toThrowError(
			expect.objectContaining({ statusCode: 413, statusMessage: 'Payload Too Large' }),
		);
	});

	it('rejects a declared oversized body before reading it', async () => {
		mockGetRequestHeader.mockReturnValue('1025');

		await expect(readJsonPayloadLimited({} as any, 1024, 'Config')).rejects.toMatchObject({
			statusCode: 413,
		});
		expect(mockGetRequestWebStream).not.toHaveBeenCalled();
	});

	it('stops a chunked request when its streamed bytes cross the limit', async () => {
		const encoder = new TextEncoder();
		mockGetRequestWebStream.mockReturnValue(
			new ReadableStream({
				start(controller) {
					controller.enqueue(encoder.encode('{"value":"'));
					controller.enqueue(encoder.encode('x'.repeat(64)));
					controller.close();
				},
			}),
		);

		await expect(readJsonPayloadLimited({} as any, 32, 'Config')).rejects.toMatchObject({
			statusCode: 413,
		});
	});

	it('parses valid JSON from the bounded byte stream', async () => {
		const encoder = new TextEncoder();
		mockGetRequestWebStream.mockReturnValue(
			new ReadableStream({
				start(controller) {
					controller.enqueue(encoder.encode('{"label":"😀"}'));
					controller.close();
				},
			}),
		);

		await expect(readJsonPayloadLimited({} as any, 64, 'Config')).resolves.toEqual({ label: '😀' });
	});

	it("prefers the middleware bounded stream over H3's original web request body", async () => {
		const encoder = new TextEncoder();
		const boundedStream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('{"bounded":true}'));
				controller.close();
			},
		});
		mockGetRequestWebStream.mockImplementation(() => {
			throw new TypeError('original request body is locked');
		});

		await expect(
			readJsonPayloadLimited({ _requestBody: boundedStream } as any, 64, 'Config'),
		).resolves.toEqual({ bounded: true });
		expect(mockGetRequestWebStream).not.toHaveBeenCalled();
	});
});
