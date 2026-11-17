import type { H3Event } from 'h3';
import { isAPIError } from 'better-auth/api';
import { setResponseStatus } from 'h3';

/**
 * A request Keepr Accounts' own routes refuse, answered as Better Auth answers
 * its own: the status, and `{ code, message }`, so a page reads either the same
 * way (`newPasswordRefusal`).
 */
export class KeeprRefusal extends Error {
	readonly statusCode: number;
	readonly code: string;

	constructor(statusCode: number, code: string, message: string) {
		super(message);
		this.statusCode = statusCode;
		this.code = code;
	}
}

/** A Better Auth refusal met inside one of Keepr Accounts' routes, as that route's own. */
export function refusalFromAuth(error: unknown): unknown {
	if (!isAPIError(error)) return error;
	const body = error.body as { code?: string; message?: string } | undefined;
	return new KeeprRefusal(
		error.statusCode,
		body?.code ?? String(error.status),
		body?.message ?? error.message,
	);
}

/** Runs a route's work, answering a `KeeprRefusal` with its status and code. */
export async function answerRefusals<T>(
	event: H3Event,
	work: () => Promise<T>,
): Promise<T | { code: string; message: string }> {
	try {
		return await work();
	} catch (error) {
		if (!(error instanceof KeeprRefusal)) throw error;
		setResponseStatus(event, error.statusCode);
		return { code: error.code, message: error.message };
	}
}

/** A field of a request body as text: anything but a string is empty. */
export function textField(value: unknown): string {
	return typeof value === 'string' ? value : '';
}
