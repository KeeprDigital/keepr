import type { Email } from './sender';

/** What Keepr Accounts writes in each email it sends. */

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

/** Paragraphs as plain text and as HTML, with `link` as the one call to action. */
function message(
	to: string,
	subject: string,
	{
		greeting,
		before,
		link,
		linkLabel,
		after,
	}: {
		greeting: string;
		before: string[];
		link: string;
		linkLabel: string;
		after: string[];
	},
): Email {
	const text = [greeting, ...before, link, ...after].join('\n\n');
	const paragraphs = (lines: string[]) =>
		lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('\n');
	const html = [
		`<p>${escapeHtml(greeting)}</p>`,
		paragraphs(before),
		`<p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p>`,
		`<p>Or paste this address into your browser: ${escapeHtml(link)}</p>`,
		paragraphs(after),
	].join('\n');
	return { to, subject, text, html };
}

/** The link a User follows to set a new password. */
export function passwordResetEmail({
	to,
	name,
	link,
}: {
	to: string;
	name: string;
	link: string;
}): Email {
	return message(to, 'Reset your Keepr password', {
		greeting: `Hello ${name},`,
		before: ['Someone asked to reset the password of your Keepr account. To choose a new one:'],
		link,
		linkLabel: 'Choose a new password',
		after: [
			'The link works once, for an hour. Setting a new password signs you out everywhere else.',
			'If you did not ask for this, you can ignore this email: your password stays as it is.',
		],
	});
}

/** An Invitation: who sent it, to which Organisation, and the link that accepts it. */
export function invitationEmail({
	to,
	inviterName,
	organisationName,
	link,
}: {
	to: string;
	inviterName: string;
	organisationName: string;
	link: string;
}): Email {
	return message(to, `${inviterName} invited you to ${organisationName} on Keepr`, {
		greeting: 'Hello,',
		before: [`${inviterName} has invited you to join ${organisationName} on Keepr. To accept:`],
		link,
		linkLabel: 'Accept the invitation',
		after: [
			'The invitation lasts seven days.',
			'If you were not expecting it, you can ignore this email: nothing happens unless you accept.',
		],
	});
}
