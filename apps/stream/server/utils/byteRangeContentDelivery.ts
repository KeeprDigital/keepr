/**
 * Shared HTTP semantics for ranged and conditional content delivery. Both the
 * Screen Output capability routes and the authenticated editor content route
 * serve immutable Graphic Asset Revision bytes through these helpers.
 */

export interface ByteRange {
	start: number;
	end: number;
}

function weakEtag(value: string): string {
	return value.trim().replace(/^W\//i, '');
}

export function ifNoneMatchMatches(value: string | null | undefined, etag: string): boolean {
	if (!value) return false;
	return value
		.split(',')
		.some((candidate) => candidate.trim() === '*' || weakEtag(candidate) === weakEtag(etag));
}

/**
 * The one byte range a `Range` header asks for, read by RFC 9110 §14.2: a
 * header this server cannot honour (malformed, another unit, several ranges,
 * a last position before the first) is ignored and the whole body is served;
 * only a well-formed single range that misses the body is unsatisfiable.
 */
export function requestedByteRange(
	value: string | null | undefined,
	byteLength: number,
): ByteRange | 'unsatisfiable' | undefined {
	if (!value) return;
	const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
	if (!match || (!match[1] && !match[2])) return;

	if (!match[1]) {
		const suffixLength = Number(match[2]);
		if (suffixLength <= 0 || byteLength === 0) return 'unsatisfiable';
		return {
			start: Math.max(0, byteLength - suffixLength),
			end: byteLength - 1,
		};
	}

	const start = Number(match[1]);
	const requestedEnd = match[2] ? Number(match[2]) : Number.POSITIVE_INFINITY;
	if (requestedEnd < start) return;
	if (start >= byteLength) return 'unsatisfiable';
	return {
		start,
		end: Math.min(requestedEnd, byteLength - 1),
	};
}

export function rangePermitted(ifRange: string | null | undefined, etag: string): boolean {
	if (!ifRange) return true;
	return ifRange.trim() === etag;
}
