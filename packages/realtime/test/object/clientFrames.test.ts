import { describe, expect, it } from 'vitest';
import { readClientFrame } from '../../src/object/frames.ts';

const read = (frame: unknown): unknown => readClientFrame(JSON.stringify(frame));

describe('readClientFrame', () => {
	it.each([
		{ t: 'attach', channel: 'news' },
		{ t: 'attach', channel: 'news', since: 0, epoch: 'e' },
		{ t: 'detach', channel: 'news' },
		{ t: 'watch', channel: 'news' },
		{ t: 'unwatch', channel: 'news' },
		{ t: 'leave', channel: 'news' },
		{ t: 'enter', channel: 'news', data: { any: ['thing'] } },
		{ t: 'update', channel: 'news', data: null },
		{ t: 'hello', epoch: 'e', attach: [{ channel: 'a', since: 3 }], watch: ['b'], presence: {} },
	])('reads $t as it was sent', (frame) => {
		expect(read(frame)).toEqual(frame);
	});

	it.each([
		{ why: 'text that is not JSON', raw: 'ping pong' },
		{ why: 'JSON that is no object', raw: '[1]' },
		{ why: 'a kind the protocol has not', raw: '{"t":"publish","channel":"news"}' },
		{ why: 'no channel', raw: '{"t":"attach"}' },
		{ why: 'a channel that is no string', raw: '{"t":"watch","channel":7}' },
		{ why: 'an empty channel', raw: '{"t":"enter","channel":"","data":1}' },
		{ why: 'the channel no object can key', raw: '{"t":"enter","channel":"__proto__","data":1}' },
		{ why: 'a sequence that is not a count', raw: '{"t":"attach","channel":"news","since":-1}' },
		{ why: 'a fractional sequence', raw: '{"t":"attach","channel":"news","since":1.5}' },
		{ why: 'an epoch that is no string', raw: '{"t":"attach","channel":"news","epoch":3}' },
	])('reads nothing from $why', ({ raw }) => {
		expect(readClientFrame(raw)).toBeUndefined();
	});

	it('reads a hello without the parts that are not what the protocol says', () => {
		expect(
			read({
				t: 'hello',
				epoch: 9,
				attach: [{ channel: 'kept', since: 2 }, { channel: 'bad', since: 'two' }, 'worse'],
				watch: ['kept', 7, ''],
				presence: ['not', 'a', 'record'],
			}),
		).toEqual({
			t: 'hello',
			attach: [{ channel: 'kept', since: 2 }],
			watch: ['kept'],
			presence: {},
		});
	});

	it('reads a bare hello as one that wants nothing', () => {
		expect(read({ t: 'hello' })).toEqual({ t: 'hello', attach: [], watch: [], presence: {} });
	});
});
