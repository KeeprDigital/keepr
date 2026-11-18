import type { EmailSender } from '~~/server/email/sender';
import process from 'node:process';
import { cloudflareEmailSender } from '~~/server/email/cloudflare';
import { createEmailRecorder } from '~~/server/email/recorder';
import { keeprSenderFor } from '~~/server/email/sender';
import { ServiceConfigurationError } from '@keepr/nuxt-layer/server/utils/errors';

/** The Worker binding Cloudflare's email service is reached through. */
const EMAIL_BINDING = 'EMAIL';

/** Where the dev server writes the email it would have sent, from `apps/accounts`. */
export const LOCAL_EMAIL_RECORD = '.data/email';

function binding(name: string): unknown {
	return (
		(process.env as Record<string, unknown>)[name] ||
		(globalThis as { __env__?: Record<string, unknown> }).__env__?.[name]
	);
}

/**
 * The email sender a running server uses. The dev server never sends: it writes
 * each message to the local email record. A built Worker sends through its
 * `EMAIL` binding, which `wrangler dev` simulates rather than sends, so a local
 * run of the built Worker mails nobody either. Without the binding, a send fails
 * naming it. A message is from Keepr at the Keepr domain of `host`, the host the
 * request was served on (`keeprSenderFor`).
 */
export function serverEmailSender(host: string): EmailSender {
	if (import.meta.dev) return createEmailRecorder({ directory: LOCAL_EMAIL_RECORD });
	return {
		async send(email) {
			const emailBinding = binding(EMAIL_BINDING);
			if (!emailBinding)
				throw new ServiceConfigurationError(
					EMAIL_BINDING,
					'is not bound, so Keepr Accounts cannot send email',
				);
			await cloudflareEmailSender(
				emailBinding as Parameters<typeof cloudflareEmailSender>[0],
				keeprSenderFor(host),
			).send(email);
		},
	};
}

/**
 * Keeps `work` running after the response to the request it began in, through
 * the Worker's `waitUntil` (`nitro.experimental.asyncContext`). Outside a request,
 * or where the platform gives no `waitUntil`, it runs on unwaited.
 */
export function runAfterResponse(work: Promise<unknown>): void {
	try {
		useEvent().context.cloudflare?.context.waitUntil(work);
	} catch {
		// No request: nothing would end the work early, so it needs no keeping.
	}
}
