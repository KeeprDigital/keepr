import type { RefusalSentences } from '~/utils/refusal';
import { describe, expect, it } from 'vitest';
import { refusalSentence } from '~/utils/refusal';

// A page says a refusal's code's sentence first, then the server's message where
// it allows one, then its status's, then its own fallback.

function refused(statusCode: number, code?: string, message?: string) {
	return { statusCode, data: { code, message } };
}

const sentences: RefusalSentences = {
	codes: { LAST_OWNER: 'Keep an owner.' },
	serverMessage: ['BANNED_USER'],
	statuses: { 429: 'Wait a moment.' },
	otherwise: 'That failed.',
};

describe('the sentence a refusal is told in', () => {
	it.each<[string, unknown, RefusalSentences, string]>([
		["is its code's", refused(429, 'LAST_OWNER', 'from the server'), sentences, 'Keep an owner.'],
		["is the server's message for a code it is allowed for", refused(403, 'BANNED_USER', 'Disabled.'), sentences, 'Disabled.'],
		["is the server's message for any code, where every one is allowed", refused(409, 'ORGANISATION_EXISTS', 'Taken.'), { ...sentences, serverMessage: true }, 'Taken.'],
		["is not the server's message for a code it is not allowed for", refused(409, 'ORGANISATION_EXISTS', 'Taken.'), sentences, 'That failed.'],
		["is its status's, when its code says nothing", refused(429, 'TOO_MANY'), sentences, 'Wait a moment.'],
		['is the fallback for anything else, a request that never answered included', new Error('offline'), sentences, 'That failed.'],
	])('%s', (_case, failure, told, sentence) => {
		expect(refusalSentence(failure, told)).toBe(sentence);
	});
});
