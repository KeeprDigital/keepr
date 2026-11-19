import type { SendEmailBinding } from '~~/server/email/cloudflare';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cloudflareEmailSender } from '~~/server/email/cloudflare';
import { createEmailRecorder } from '~~/server/email/recorder';
import { keeprSenderFor } from '~~/server/email/sender';

// The two implementations of the email seam: Cloudflare's service, and the recorder
// local runs write to instead of sending.

const EMAIL = {
	to: 'ada@keepr.digital',
	subject: 'Reset your Keepr password',
	text: 'Hello Ada,\n\nhttps://accounts.keepr.digital/reset-password#token=abc',
	html: '<p>Hello Ada,</p>',
};

describe("Cloudflare's email service", () => {
	it('is handed each message from Keepr, accounts@keepr.digital', async () => {
		const handed: unknown[] = [];
		const binding: SendEmailBinding = {
			send: async (message) => {
				handed.push(message);
				return { messageId: 'm-1' };
			},
		};

		await cloudflareEmailSender(binding).send(EMAIL);

		expect(handed).toEqual([
			{ ...EMAIL, from: { email: 'accounts@keepr.digital', name: 'Keepr' } },
		]);
	});

	// Each Installation sends from its own Keepr domain, the one its account may send as.
	it.each([
		['production', 'accounts.keepr.digital', 'accounts@keepr.digital'],
		['staging', 'accounts.keepr-staging.digital', 'accounts@keepr-staging.digital'],
		['a local run', 'localhost:8790', 'accounts@keepr.digital'],
	])('is handed, in %s, each message from Keepr at its domain', async (_case, host, address) => {
		const handed: { from: unknown }[] = [];
		const binding: SendEmailBinding = {
			send: async (message) => {
				handed.push(message);
				return { messageId: 'm-1' };
			},
		};

		await cloudflareEmailSender(binding, keeprSenderFor(host)).send(EMAIL);

		expect(handed.map(({ from }) => from)).toEqual([{ email: address, name: 'Keepr' }]);
	});

	it('fails a send it refuses, with its reason', async () => {
		const refusal = Object.assign(new Error('sender domain not verified'), {
			code: 'E_SENDER_NOT_VERIFIED',
		});
		const binding: SendEmailBinding = { send: async () => Promise.reject(refusal) };

		await expect(cloudflareEmailSender(binding).send(EMAIL)).rejects.toBe(refusal);
	});
});

describe('the local email record', () => {
	let directory: string;

	afterEach(async () => await rm(directory, { recursive: true, force: true }));

	it('is a file per message, readable as the email would have been', async () => {
		directory = join(await mkdtemp(join(tmpdir(), 'keepr-email-')), 'email');

		await createEmailRecorder({ directory }).send(EMAIL);

		const files = await readdir(directory);
		expect(files).toHaveLength(1);
		const record = await readFile(join(directory, files[0]!), 'utf8');
		expect(record).toContain('From: Keepr <accounts@keepr.digital>');
		expect(record).toContain('To: ada@keepr.digital');
		expect(record).toContain('Subject: Reset your Keepr password');
		expect(record).toContain(EMAIL.text);
	});
});
