import { failureStatus } from '@keepr/nuxt-layer/app/utils/failureStatus';
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '~~/shared/utils/newPassword';

/**
 * A refused request, as a page reads what `$fetch` threw. Better Auth's routes
 * and Keepr Accounts' own answer alike: a status, and `{ code, message }`.
 */
export interface Refusal {
	status: number | undefined;
	code: string | undefined;
	message: string | undefined;
}

export function readRefusal(failure: unknown): Refusal {
	const data = (failure as { data?: { code?: unknown; message?: unknown } } | null)?.data;
	return {
		status: failureStatus(failure),
		code: typeof data?.code === 'string' ? data.code : undefined,
		message: typeof data?.message === 'string' ? data.message : undefined,
	};
}

/** What a page tells its User about a refusal. */
export interface RefusalSentences {
	/** What a refusal with each code says. */
	codes?: Readonly<Record<string, string>>;
	/**
	 * Where the server's own message is said: for every code with no sentence of
	 * its own (`true`), or for these codes only.
	 */
	serverMessage?: true | readonly string[];
	/** What a refusal with each status says, when its code has said nothing. */
	statuses?: Readonly<Record<number, string>>;
	/** What anything else says. */
	otherwise: string;
}

/**
 * The sentence for `failure`: its code's, then the server's message where
 * allowed, then its status's, then `otherwise`.
 */
export function refusalSentence(failure: unknown, sentences: RefusalSentences): string {
	const { status, code, message } = readRefusal(failure);
	const { codes = {}, serverMessage = [], statuses = {}, otherwise } = sentences;
	if (code !== undefined && Object.hasOwn(codes, code)) return codes[code]!;
	if (message && (serverMessage === true || (code !== undefined && serverMessage.includes(code))))
		return message;
	if (status !== undefined && Object.hasOwn(statuses, status)) return statuses[status]!;
	return otherwise;
}

/** What a User whose new password was refused is told, on whichever page set it. */
export const NEW_PASSWORD_REFUSALS = {
	codes: {
		PASSWORD_TOO_SHORT: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
		PASSWORD_TOO_LONG: `Choose a password of at most ${MAX_PASSWORD_LENGTH} characters.`,
		PASSWORD_COMPROMISED:
			'That password is known from a data breach, so attackers try it. Choose another.',
	},
	// The breach check could not be made, and no password is set without it.
	statuses: {
		500: 'Your new password could not be checked just now. Try again in a few minutes.',
	},
} as const satisfies Omit<RefusalSentences, 'otherwise'>;

/** What a User whose name was refused is told, on whichever page set it. */
export const USER_NAME_REFUSALS = {
	codes: { NAME_REQUIRED: 'Enter your name.' },
} as const satisfies Omit<RefusalSentences, 'otherwise'>;
