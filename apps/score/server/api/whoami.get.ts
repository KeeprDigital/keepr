// Spike 1 (#1256): an App route that asks the accounts service who the request
// belongs to, over the Worker-to-Worker connection, forwarding the cookie.
export default defineEventHandler(async (event) => {
	const accounts = (event.context.cloudflare?.env as { ACCOUNTS?: { fetch: typeof fetch } } | undefined)?.ACCOUNTS;
	if (!accounts) {
		throw createError({ statusCode: 503, statusMessage: 'ACCOUNTS binding missing' });
	}
	const response = await accounts.fetch('https://accounts.internal/api/auth/token', {
		headers: { cookie: getRequestHeader(event, 'cookie') ?? '' },
	});
	const renewed = response.headers.getSetCookie?.() ?? [];
	for (const cookie of renewed) appendResponseHeader(event, 'set-cookie', cookie);
	const text = await response.text();
	return { status: response.status, body: text.startsWith('{') ? JSON.parse(text) : text };
});
