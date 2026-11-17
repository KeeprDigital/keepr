// Spike 1 (#1256): answers as the Local Developer User. What it answers is not
// the question; that an App under `nuxt dev` reaches it over a service binding is.
export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		return Response.json({
			from: 'stand-in',
			method: request.method,
			url: request.url,
			path: url.pathname,
			cookie: request.headers.get('cookie'),
			user: { id: 'local-developer', email: 'developer@localhost', name: 'Local Developer' },
		}, {
			headers: { 'set-cookie': 'better-auth.session_token=renewed; Path=/; HttpOnly; SameSite=Lax' },
		});
	},
};
