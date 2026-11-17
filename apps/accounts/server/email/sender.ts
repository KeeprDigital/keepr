/**
 * The one way Keepr Accounts sends email (#1228 § Email). Two implementations:
 * Cloudflare's email service (`cloudflareEmailSender`), and the recorder tests and
 * local runs use instead (`createEmailRecorder`), so nothing local ever mails a
 * real person.
 */

/** One message to one person. The sender is always `KEEPR_SENDER`. */
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

/** Who every email from Keepr Accounts is from. */
export const KEEPR_SENDER = { email: 'accounts@keepr.digital', name: 'Keepr' } as const;
