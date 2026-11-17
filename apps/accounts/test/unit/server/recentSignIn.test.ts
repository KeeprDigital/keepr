import type { KeeprRefusal } from '~~/server/utils/refusal';
import { describe, expect, it } from 'vitest';
import { requireRecentSignIn } from '~~/server/utils/recentSignIn';

// A sensitive action needs a sign-in no older than ten minutes, checked by Keepr
// Accounts itself; an older one is asked to sign in again.

const SIGNED_IN_AT = new Date('2026-11-17T10:00:00Z');
const MINUTE_MS = 60 * 1000;

describe('a sign-in', () => {
	it.each([
		['ten minutes old', null, 10 * MINUTE_MS],
		['a moment over ten minutes old', 'RECENT_SIGN_IN_REQUIRED', 10 * MINUTE_MS + 1],
	])('%s: refused %s', (_case, refusal, ageMs) => {
		let refused: { statusCode: number; code: string } | null = null;
		try {
			requireRecentSignIn({ signedInAt: SIGNED_IN_AT }, new Date(SIGNED_IN_AT.getTime() + ageMs));
		} catch (error) {
			const { statusCode, code } = error as KeeprRefusal;
			refused = { statusCode, code };
		}

		expect(refused).toEqual(refusal === null ? null : { statusCode: 403, code: refusal });
	});
});
