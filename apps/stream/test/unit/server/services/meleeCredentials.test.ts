import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';

const mockRuntimeConfig = vi.fn();
vi.stubGlobal('useRuntimeConfig', mockRuntimeConfig);

const {
	getMeleeCredentialKeyring,
	meleeKeyringConfigurationFaultSentence,
	protectMeleeClientSecret,
	revealMeleeClientSecret,
} = await import('~~/server/services/meleeCredentials');

const KEY_VERSION_VAR = 'NUXT_MELEE_CREDENTIAL_KEY_VERSION';

type Vars = { vars?: Record<string, unknown> };
const wrangler = parseJsonc(readFileSync('wrangler.jsonc', 'utf8')) as Vars & {
	env: Record<string, Vars>;
};

/** Each Environment's key version as its Wrangler config sets it, where it sets one (ADR-0132). */
const CONFIGURED_KEY_VERSIONS = (
	[
		['production', wrangler.vars],
		...Object.entries(wrangler.env).map(([name, block]) => [name, block.vars]),
	] as [string, Vars['vars']][]
).flatMap(([environment, vars]) => {
	const version = vars?.[KEY_VERSION_VAR];
	return typeof version === 'string' && version.trim() ? [[environment, version] as const] : [];
});

function base64Key(fill: number): string {
	return btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));
}

describe('melee credential runtime service', () => {
	beforeEach(() => {
		mockRuntimeConfig.mockReset().mockReturnValue({
			meleeCredentialEncryptionKey: base64Key(2),
			meleeCredentialKeyVersion: 'v2',
			meleeCredentialEncryptionPreviousKeys: JSON.stringify({
				v1: base64Key(1),
			}),
		});
	});

	it('encrypts with the active deployment key and decrypts at the adapter boundary', async () => {
		const protectedValue = await protectMeleeClientSecret('client-secret');

		expect(protectedValue).not.toContain('client-secret');
		await expect(revealMeleeClientSecret(protectedValue)).resolves.toMatchObject({
			plaintext: 'client-secret',
			keyVersion: 'v2',
			needsReEncryption: false,
		});
	});

	it('makes previous deployment keys available for rotation', () => {
		const keyring = getMeleeCredentialKeyring();

		expect(keyring.activeKeyVersion).toBe('v2');
		expect(keyring.keys.get('v1')).toBe(base64Key(1));
		expect(keyring.keys.get('v2')).toBe(base64Key(2));
	});

	/**
	 * The trap #412's verification walked into: `.env.example` assigns
	 * `NUXT_MELEE_CREDENTIAL_KEY_VERSION=1`, and runtimeConfig applies
	 * environment overrides through `destr` — so what arrives here is the **number**
	 * 1, not the string a reader who typed it would swear they set. Read as "not a
	 * string, therefore not configured", a checkout that followed the example file
	 * exactly answered 503 naming the very setting it had set.
	 *
	 * Measured on a previewed Worker: `=1` answered 503 and `=v1` answered 200, with
	 * nothing else changed. A deployed installation is in the same position, because
	 * a Worker secret reaches runtimeConfig through the same coercion.
	 */
	it('reads a key version the environment handed over as a number', async () => {
		mockRuntimeConfig.mockReturnValue({
			meleeCredentialEncryptionKey: base64Key(2),
			// `NUXT_MELEE_CREDENTIAL_KEY_VERSION=1`, after destr.
			meleeCredentialKeyVersion: 1,
			meleeCredentialEncryptionPreviousKeys: '',
		});

		const keyring = getMeleeCredentialKeyring();

		expect(keyring.activeKeyVersion).toBe('1');
		expect(keyring.keys.get('1')).toBe(base64Key(2));
		// End to end, because the keyring being right is only half of it: the
		// envelope's stored version has to match what a rotation keyring's JSON
		// object keys are, and those are strings.
		const revealed = await revealMeleeClientSecret(await protectMeleeClientSecret('client-secret'));

		expect(revealed).toMatchObject({ plaintext: 'client-secret', keyVersion: '1' });
	});

	/**
	 * The same coercion, one name along and worse: `.env.example` documents
	 * `NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS={"1":"OLD_BASE64_KEY"}`, and
	 * destr parses that into an object before this ever sees it. Read as "not a
	 * string, therefore no retired keys", a rotation would silently lose every key
	 * it was told to keep — and the failure lands on decrypting credentials stored
	 * before the rotation, not on the rotation itself.
	 */
	it('reads retired keys the environment handed over already parsed', () => {
		mockRuntimeConfig.mockReturnValue({
			meleeCredentialEncryptionKey: base64Key(2),
			meleeCredentialKeyVersion: 'v2',
			// The JSON in `.env.example`, after destr.
			meleeCredentialEncryptionPreviousKeys: {
				1: base64Key(1),
			},
		});

		const keyring = getMeleeCredentialKeyring();

		expect(keyring.keys.get('1')).toBe(base64Key(1));
		expect(keyring.keys.get('v2')).toBe(base64Key(2));
	});

	/**
	 * Coercing what an operator plainly meant must not become coercing anything at
	 * all: a keyring is the one place where reading a value loosely means quietly
	 * decrypting with the wrong material or refusing to at all. Only the two shapes
	 * an environment can actually deliver — a number and an already-parsed object —
	 * are read; everything else still refuses by name.
	 */
	it.each([
		['an array', [base64Key(1)]],
		['a bare number', 1],
		['a boolean', true],
	])('still refuses previous keys handed over as %s', (_shape, configuredValue) => {
		mockRuntimeConfig.mockReturnValue({
			meleeCredentialEncryptionKey: base64Key(2),
			meleeCredentialKeyVersion: 'v2',
			meleeCredentialEncryptionPreviousKeys: configuredValue,
		});

		expect(() => getMeleeCredentialKeyring()).toThrowError(
			expect.objectContaining({
				code: 'MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID',
			}),
		);
	});

	it('reports malformed previous-key configuration without including its contents', () => {
		const configuredValue = '{not-json-secret-material}';
		mockRuntimeConfig.mockReturnValue({
			meleeCredentialEncryptionKey: base64Key(2),
			meleeCredentialKeyVersion: 'v2',
			meleeCredentialEncryptionPreviousKeys: configuredValue,
		});

		expect(() => getMeleeCredentialKeyring()).toThrowError(
			expect.objectContaining({
				code: 'MELEE_CREDENTIAL_PREVIOUS_KEYS_INVALID',
				message: expect.not.stringContaining(configuredValue),
			}),
		);
	});

	// The key version is a var in each Environment's config, not a Worker secret (ADR-0132).
	it.each(CONFIGURED_KEY_VERSIONS)(
		'encrypts under the key version the %s config sets',
		async (_environment, version) => {
			mockRuntimeConfig.mockReturnValue({
				meleeCredentialEncryptionKey: base64Key(2),
				meleeCredentialKeyVersion: version,
			});

			const revealed = await revealMeleeClientSecret(
				await protectMeleeClientSecret('client-secret'),
			);

			expect(revealed).toMatchObject({ plaintext: 'client-secret', keyVersion: version });
		},
	);

	it.each([
		['a var left empty', ' '],
		['no setting at all', undefined],
	])(
		'refuses to encrypt with %s for the key version, naming the setting',
		async (_case, version) => {
			mockRuntimeConfig.mockReturnValue({
				meleeCredentialEncryptionKey: base64Key(2),
				meleeCredentialKeyVersion: version,
			});

			const refusal = await protectMeleeClientSecret('client-secret').catch((error) => error);

			expect(refusal).toMatchObject({ code: 'MELEE_CREDENTIAL_KEY_VERSION_MISSING' });
			expect(meleeKeyringConfigurationFaultSentence(refusal)).toBe(
				`${KEY_VERSION_VAR} is not configured`,
			);
		},
	);
});
