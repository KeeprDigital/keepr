/**
 * Scryfall at the network boundary, matching names as the live API does: a lone name
 * prefers the card of exactly that name, but `/cards/collection` answers a name with an
 * earlier identifier's card when the name is one of its faces. Only `/cards/search`
 * matches a name printed on a printing in place of its own.
 */

export interface FakeScryfallCard {
	id: string;
	name: string;
	set: string;
	/** `1` where a test does not name it. */
	collector_number?: string;
	type_line?: string;
	/** Colour identity letters, alphabetical as Scryfall lists them; none where a test does not name it. */
	color_identity?: string[];
	/** The name a Universes Within printing is printed with. */
	flavor_name?: string;
	/** The name an English printing is printed with in place of its own, as Secret Lair's Walking Dead cards are. */
	printed_name?: string;
}

/** What `/cards/collection` is asked for: a name, in a set or not, or one exact printing. */
type FakeIdentifier = { name: string; set?: string } | { set: string; collector_number: string };

function sameName(a: string, b: string): boolean {
	return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function hasFace(card: FakeScryfallCard, name: string): boolean {
	const faces = card.name.split(' // ');
	return faces.length > 1 && faces.some((face) => sameName(face, name));
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function toScryfallJson(card: FakeScryfallCard) {
	return {
		id: card.id,
		name: card.name,
		set: card.set,
		collector_number: card.collector_number ?? '1',
		oracle_id: `oracle-${card.id}`,
		mana_cost: null,
		cmc: 1,
		color_identity: card.color_identity ?? [],
		type_line: card.type_line ?? 'Sorcery',
		...(card.flavor_name ? { flavor_name: card.flavor_name } : {}),
		...(card.printed_name ? { printed_name: card.printed_name } : {}),
	};
}

/** `searchPageSize`: the cards a search page holds, 175 as on Scryfall unless a test pages sooner. */
export function createScryfallFake(
	catalogue: readonly FakeScryfallCard[],
	options: { searchPageSize?: number } = {},
) {
	const searchPageSize = options.searchPageSize ?? 175;
	const namedLookups: string[] = [];
	const collectionBatches: string[][] = [];
	const searches: string[] = [];

	const inSet = (card: FakeScryfallCard, set: string | null | undefined) =>
		!set || sameName(card.set, set);

	const findByName = (name: string, set?: string | null) =>
		catalogue.find((card) => inSet(card, set) && sameName(card.name, name)) ??
		catalogue.find((card) => inSet(card, set) && hasFace(card, name)) ??
		null;

	const findPrinting = (set: string, collectorNumber: string) =>
		catalogue.find(
			(card) => sameName(card.set, set) && sameName(card.collector_number ?? '1', collectorNumber),
		) ?? null;

	const collection = (identifiers: FakeIdentifier[]) => {
		collectionBatches.push(
			identifiers.map((identifier) =>
				'name' in identifier ? identifier.name : `${identifier.set}/${identifier.collector_number}`,
			),
		);
		const data: FakeScryfallCard[] = [];
		const notFound: FakeIdentifier[] = [];
		for (const identifier of identifiers) {
			const card = !('name' in identifier)
				? findPrinting(identifier.set, identifier.collector_number)
				: identifier.name.includes(' // ')
					? null
					: (data.find(
							(earlier) => inSet(earlier, identifier.set) && hasFace(earlier, identifier.name),
						) ?? findByName(identifier.name, identifier.set));
			if (card) data.push(card);
			else notFound.push(identifier);
		}
		return json({
			object: 'list',
			not_found: notFound,
			data: data.map(toScryfallJson),
		});
	};

	const named = (url: URL) => {
		const name = url.searchParams.get('exact') ?? url.searchParams.get('fuzzy') ?? '';
		namedLookups.push(name);
		const card = findByName(name, url.searchParams.get('set'));
		return card ? json(toScryfallJson(card)) : json({ object: 'error', status: 404 }, 404);
	};

	// `!"name"` or `!'name'`, alone or `set:` narrowed, joined by `or`, paged by `next_page`.
	const search = (url: URL) => {
		const query = url.searchParams.get('q') ?? '';
		searches.push(query);
		const terms = [...query.matchAll(/!(?:"([^"]+)"|'([^']+)')(?: set:([a-z0-9]+))?/g)].map(
			([, doubleQuoted, singleQuoted, set]) => ({ name: (doubleQuoted ?? singleQuoted)!, set }),
		);
		const printedWith = (card: FakeScryfallCard, name: string) =>
			sameName(card.name, name) ||
			hasFace(card, name) ||
			[card.flavor_name, card.printed_name].some(
				(printed) => printed !== undefined && sameName(printed, name),
			);
		const data = catalogue.filter((card) =>
			terms.some((term) => inSet(card, term.set) && printedWith(card, term.name)),
		);
		const page = Number(url.searchParams.get('page') ?? '1');
		const hasMore = page * searchPageSize < data.length;
		const nextPage = new URL(url);
		nextPage.searchParams.set('page', String(page + 1));
		return data.length > 0
			? json({
					object: 'list',
					has_more: hasMore,
					...(hasMore
						? {
								next_page: nextPage.toString(),
							}
						: {}),
					data: data.slice((page - 1) * searchPageSize, page * searchPageSize).map(toScryfallJson),
				})
			: json({ object: 'error', code: 'not_found', status: 404 }, 404);
	};

	const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
		const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
		if (url.pathname === '/cards/collection')
			return collection(JSON.parse(String(init?.body)).identifiers);
		if (url.pathname === '/cards/named') return named(url);
		if (url.pathname === '/cards/search') return search(url);
		throw new Error(`Unexpected Scryfall request: ${url}`);
	};

	return {
		fetch,
		namedLookups,
		collectionBatches,
		searches,
	};
}

/** Cards a face of which is also a standalone card's name, as on Scryfall. */
export const FACE_NAME_COLLISIONS = {
	schemingSilvertongue: {
		id: 'scheming-silvertongue',
		name: 'Scheming Silvertongue // Sign in Blood',
		set: 'sos',
		type_line: 'Creature — Vampire Warlock // Sorcery — Prepare',
	},
	signInBlood: { id: 'sign-in-blood', name: 'Sign in Blood', set: 'dsc' },
	emeritusOfConflict: {
		id: 'emeritus-of-conflict',
		name: 'Emeritus of Conflict // Lightning Bolt',
		set: 'sos',
		type_line: 'Creature — Human Wizard // Instant — Prepare',
	},
	lightningBolt: {
		id: 'lightning-bolt',
		name: 'Lightning Bolt',
		set: 'msc',
		type_line: 'Instant',
	},
	bindLiberate: { id: 'bind-liberate', name: 'Bind // Liberate', set: 'unk' },
	bind: {
		id: 'bind',
		name: 'Bind',
		set: 'inv',
		type_line: 'Instant',
	},
	delverOfSecrets: {
		id: 'delver-of-secrets',
		name: 'Delver of Secrets // Insectile Aberration',
		set: 'inr',
		type_line: 'Creature — Human Wizard // Creature — Human Insect',
	},
} satisfies Record<string, FakeScryfallCard>;
