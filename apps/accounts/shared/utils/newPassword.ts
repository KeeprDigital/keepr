/** The fewest characters a new password may have, on every path that sets one. */
export const MIN_PASSWORD_LENGTH = 8;

/** The most, so hashing one cannot be made to take long. */
export const MAX_PASSWORD_LENGTH = 128;

/** A refused request to Better Auth's routes, as `$fetch` throws it. */
export interface AuthFailure {
	statusCode?: number;
	data?: { code?: string; message?: string };
}

/**
 * What to tell a User whose new password was refused, on whichever page set it.
 * `undefined` when the refusal was not about the new password.
 */
export function newPasswordRefusal(failure: AuthFailure): string | undefined {
	switch (failure.data?.code) {
		case 'PASSWORD_TOO_SHORT':
			return `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`;
		case 'PASSWORD_TOO_LONG':
			return `Choose a password of at most ${MAX_PASSWORD_LENGTH} characters.`;
		case 'PASSWORD_COMPROMISED':
			return 'That password is known from a data breach, so attackers try it. Choose another.';
	}
	// The breach check could not be made, and no password is set without it.
	if (failure.statusCode === 500)
		return 'Your new password could not be checked just now. Try again in a few minutes.';
	return undefined;
}
