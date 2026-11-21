/**
 * A JSON value rendered as one comparable string, object keys ordered by
 * codepoint at every depth.
 *
 * Two values that differ only in key order render identically, which is what
 * comparing a stored document with the same document as a client sent it back
 * needs. A value renders as JSON would carry it: through its `toJSON`, an
 * undefined or function entry dropped from an object and `null` in an array.
 * Ordered by codepoint rather than locale, so the result is the same in every
 * process that renders it.
 */
export function canonicalJson(value: unknown): string {
	return render(value) ?? 'undefined';
}

function render(value: unknown): string | undefined {
	const carried =
		value &&
		typeof value === 'object' &&
		typeof (value as { toJSON?: unknown }).toJSON === 'function'
			? (value as { toJSON: () => unknown }).toJSON()
			: value;
	if (Array.isArray(carried))
		return `[${carried.map((entry) => render(entry) ?? 'null').join(',')}]`;
	if (carried && typeof carried === 'object') {
		return `{${Object.entries(carried)
			.toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.flatMap(([key, entry]) => {
				const rendered = render(entry);
				return rendered === undefined ? [] : [`${JSON.stringify(key)}:${rendered}`];
			})
			.join(',')}}`;
	}
	return JSON.stringify(carried) as string | undefined;
}
