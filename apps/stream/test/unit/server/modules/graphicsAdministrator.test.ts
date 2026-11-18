import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { createEvent } from 'h3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	LOCAL_AUTH_BYPASS_ENABLED_VALUE,
	LOCAL_AUTH_BYPASS_NAME,
	LOCAL_DEVELOPER_USER_ID,
} from '~~/shared/utils/localDeveloperAuth';

vi.mock('~~/server/db', () => ({ db: {}, schema: {} }));

const mockUseRuntimeConfig = vi.fn();
vi.stubGlobal('useRuntimeConfig', mockUseRuntimeConfig);
vi.stubGlobal('createError', (input: { statusCode: number; message: string }) =>
	Object.assign(new Error(input.message), input),
);

/** The guard over a real auth module whose only fake is Better Auth's session read. */
async function guardReading(session: unknown) {
	vi.resetModules();
	mockUseRuntimeConfig.mockReturnValue({ betterAuthSecret: 'a-configured-secret-0000000000' });
	const auth = await import('~~/server/utils/auth');
	vi.spyOn(auth.serverAuth().api, 'getSession').mockResolvedValue({
		headers: new Headers(),
		response: session,
	} as never);
	return (await import('~~/server/modules/graphics-administrator')).requireGraphicsAdministrator;
}

function requestEvent() {
	const request = new IncomingMessage(new Socket());
	return createEvent(request, new ServerResponse(request));
}

function signedInAs(role: string | null) {
	return { session: { id: 'a-browser-session' }, user: { id: 'a-user', role } };
}

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('the Graphics Administrator guard', () => {
	// Better Auth stores a User's roles as one comma-separated column.
	it.each([
		['holds only the role', 'admin'],
		['holds it among others', 'user, admin'],
	])('admits a signed-in User who %s, answering who they are', async (_label, role) => {
		const guard = await guardReading(signedInAs(role));

		await expect(guard(requestEvent())).resolves.toBe('a-user');
	});

	it.each([
		['holds no role', null],
		['holds another role', 'user'],
		['holds a role that only contains its name', 'admins'],
	])('refuses a signed-in User who %s with 403', async (_label, role) => {
		const guard = await guardReading(signedInAs(role));

		await expect(guard(requestEvent())).rejects.toMatchObject({
			statusCode: 403,
			message: 'Graphics Administrator authorization is required',
		});
	});

	it('refuses a request with no Session with 401', async () => {
		const guard = await guardReading(null);

		await expect(guard(requestEvent())).rejects.toMatchObject({
			statusCode: 401,
			message: 'Authentication is required',
		});
	});

	it('admits the Local Developer User, who holds the highest App role', async () => {
		vi.stubEnv(LOCAL_AUTH_BYPASS_NAME, LOCAL_AUTH_BYPASS_ENABLED_VALUE);
		const guard = await guardReading(null);

		await expect(guard(requestEvent())).resolves.toBe(LOCAL_DEVELOPER_USER_ID);
	});
});
