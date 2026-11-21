import { beforeEach, describe, expect, it, vi } from 'vitest';

// A Seat's Commander search asks Scryfall for the name the Operator typed, and
// nothing else: query syntax in the text is part of the name. Faked at `$fetch`.

const asked = vi.fn(async (_url: string, _options: { query: Record<string, string> }) => ({
	data: [],
}));
vi.stubGlobal('$fetch', asked);

const { searchCommanderCards } = await import('~/utils/commanderSearch');

beforeEach(() => asked.mockClear());

describe('searchCommanderCards', () => {
	it.each([
		{ case: 'a plain name', text: 'atraxa', q: 'name:"atraxa" game:paper' },
		{ case: 'query syntax', text: 't:legend or c:g', q: 'name:"t:legend or c:g" game:paper' },
		{
			case: 'a double quote',
			text: 'Kongming, "Sleeping Dragon"',
			q: `name:'Kongming, "Sleeping Dragon"' game:paper`,
		},
		{ case: 'both quotes', text: `a"b'c`, q: `name:"ab'c" game:paper` },
	])('asks for $case as a name alone', async ({ text, q }) => {
		await searchCommanderCards(text);

		expect(asked.mock.calls[0]![1].query).toEqual({ q, unique: 'cards' });
	});
});
