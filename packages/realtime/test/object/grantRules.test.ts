import { describe, expect, it } from 'vitest';
import {
	allows,
	holdGrant,
	MAX_GRANT_CHANNELS_LENGTH,
	MAX_GRANT_TAG_LENGTH,
	MAX_GRANT_TAGS,
} from '../../src/object/grant.ts';
import type { Grant } from '../../src/object/grant.ts';

describe('allows', () => {
	it.each([
		{ patterns: ['news'], channel: 'news', allowed: true },
		{ patterns: ['news'], channel: 'news:late', allowed: false },
		{ patterns: ['room:1:*'], channel: 'room:1:news', allowed: true },
		{ patterns: ['room:1:*'], channel: 'room:1:', allowed: true },
		{ patterns: ['room:1:*'], channel: 'room:12:news', allowed: false },
		{ patterns: ['*'], channel: 'anything', allowed: true },
		{ patterns: ['sport', 'room:*'], channel: 'room:2', allowed: true },
		// Only a trailing `*` is a prefix.
		{ patterns: ['room:*:news'], channel: 'room:1:news', allowed: false },
		{ patterns: ['room:*:news'], channel: 'room:*:news', allowed: true },
		{ patterns: [], channel: 'news', allowed: false },
	])('$patterns covers $channel: $allowed', ({ patterns, channel, allowed }) => {
		expect(allows(patterns, channel)).toBe(allowed);
	});
});

describe('holdGrant', () => {
	const grant: Grant = { identity: 'someone', hear: ['news'] };

	it('holds what was granted, and nothing where the grant says nothing', () => {
		expect(holdGrant({ ...grant, enter: ['news'], tags: ['key:1', 'key:1'] })).toEqual({
			hear: ['news'],
			enter: ['news'],
			tags: ['key:1'],
		});
		expect(holdGrant(grant)).toEqual({ hear: ['news'], enter: [], tags: [] });
	});

	it.each([
		{ why: 'no identity', bad: { ...grant, identity: '' } },
		{ why: 'a channel that is no name', bad: { ...grant, hear: [''] } },
		{ why: 'a list that is not one', bad: { ...grant, enter: 'news' as unknown as string[] } },
		{
			why: 'more tags than a socket carries',
			bad: { ...grant, tags: Array.from({ length: MAX_GRANT_TAGS + 1 }, (_, n) => `key:${n}`) },
		},
		{ why: 'a tag too long', bad: { ...grant, tags: ['k'.repeat(MAX_GRANT_TAG_LENGTH + 1)] } },
		{
			why: 'more channel names than an attachment holds',
			bad: { ...grant, hear: ['c'.repeat(MAX_GRANT_CHANNELS_LENGTH + 1)] },
		},
	])('throws at $why', ({ bad }) => {
		expect(() => holdGrant(bad)).toThrow(TypeError);
	});

	it.each([
		{ what: 'as many tags as a socket carries', tags: MAX_GRANT_TAGS, length: 1 },
		{ what: 'a tag of the longest length', tags: 1, length: MAX_GRANT_TAG_LENGTH },
	])('holds $what', ({ tags, length }) => {
		const held = holdGrant({
			...grant,
			tags: Array.from({ length: tags }, (_, n) => String(n).padEnd(length, 'k')),
		});
		expect(held.tags).toHaveLength(tags);
	});
});
