/**
 * What a Session records of the browser that signed in, its address and its
 * agent, for a sign-in Keepr Accounts makes on that browser's behalf.
 */
export function browserHeaders(headers: Headers | undefined): Headers {
	const kept = new Headers();
	for (const name of ['cf-connecting-ip', 'user-agent']) {
		const value = headers?.get(name);
		if (value) kept.set(name, value);
	}
	return kept;
}
