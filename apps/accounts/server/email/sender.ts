/**
 * The one way Keepr Accounts sends email (#1228 § Email). Two implementations:
 * Cloudflare's email service (`cloudflareEmailSender`), and the recorder tests and
 * local runs use instead (`createEmailRecorder`), so nothing local ever mails a
 * real person.
 */

import { installationDomainOf } from '~~/shared/utils/keeprDomain';

/** One message to one person, from Keepr (`keeprSenderFor`). */
export interface Email {
	to: string;
	subject: string;
	/** The whole message as plain text; every link in `html` is in it too. */
	text: string;
	html: string;
}

export interface EmailSender {
	/** Settles once the message is handed on, and rejects if it could not be. */
	send: (email: Email) => Promise<void>;
}

/** Who an email from Keepr Accounts is from. */
export interface KeeprSender {
	email: string;
	name: 'Keepr';
}

/** Who every email from Keepr Accounts is from, in production and in a local run. */
export const KEEPR_SENDER: KeeprSender = { email: 'accounts@keepr.digital', name: 'Keepr' };

/**
 * Who an email from Keepr Accounts served at `host` is from: Keepr, at its
 * Installation's Keepr domain, the one domain its account may send as
 * (`wrangler.jsonc`'s `send_email`).
 */
export function keeprSenderFor(host: string): KeeprSender {
	return { email: `accounts@${installationDomainOf(host)}`, name: 'Keepr' };
}
