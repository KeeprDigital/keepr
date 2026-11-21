/**
 * Whether `text` carries a control character: C0, delete or C1. A browser drops a
 * tab or line break from an address, and an email subject or a token carries one
 * as a break, so neither a name nor a Return Address may hold one (#1385).
 */
export function hasControlCharacter(text: string): boolean {
	return /\p{Cc}/u.test(text);
}
