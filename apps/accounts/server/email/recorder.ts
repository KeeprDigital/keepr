import type { Email, EmailSender } from './sender';
import { KEEPR_SENDER } from './sender';

export interface EmailRecorder extends EmailSender {
	/** Every message sent, oldest first. */
	readonly sent: readonly Email[];
}

/** A message as a person would read it: its headers, then its plain text. */
function readable(email: Email): string {
	return [
		`From: ${KEEPR_SENDER.name} <${KEEPR_SENDER.email}>`,
		`To: ${email.to}`,
		`Subject: ${email.subject}`,
		'',
		email.text,
		'',
	].join('\n');
}

function fileName(email: Email, sequence: number): string {
	const at = new Date().toISOString().replaceAll(':', '-');
	const subject = email.subject.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
	return `${at}-${sequence}-${subject}.txt`;
}

/**
 * An email sender that sends nothing: it keeps each message instead and, given a
 * `directory`, writes each there as a text file and says where. Tests read
 * `sent`; the dev server reads like a mailbox from the directory.
 */
export function createEmailRecorder({ directory }: { directory?: string } = {}): EmailRecorder {
	const sent: Email[] = [];
	return {
		sent,
		async send(email) {
			sent.push(email);
			if (directory === undefined) return;
			// Imported here, so a Worker bundle that never records carries no file system.
			const { mkdir, writeFile } = await import('node:fs/promises');
			const { join } = await import('node:path');
			await mkdir(directory, { recursive: true });
			const path = join(directory, fileName(email, sent.length));
			await writeFile(path, readable(email), 'utf8');
			console.info(`Email to ${email.to} not sent: recorded in ${path}`);
		},
	};
}
