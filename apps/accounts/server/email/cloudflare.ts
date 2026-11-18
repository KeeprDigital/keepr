import type { EmailSender, KeeprSender } from './sender';
import { KEEPR_SENDER } from './sender';

/**
 * The part of Cloudflare's `send_email` binding Keepr Accounts uses: a structured
 * message in, a message id out, an `Error` with a `code` when it is refused.
 */
export interface SendEmailBinding {
	send: (message: {
		to: string;
		from: { email: string; name: string };
		subject: string;
		text: string;
		html: string;
	}) => Promise<{ messageId: string }>;
}

/** Sends through Cloudflare's email service, as `from`: production's sender unless named. */
export function cloudflareEmailSender(
	binding: SendEmailBinding,
	from: KeeprSender = KEEPR_SENDER,
): EmailSender {
	return {
		async send({ to, subject, text, html }) {
			await binding.send({ to, from: { ...from }, subject, text, html });
		},
	};
}
