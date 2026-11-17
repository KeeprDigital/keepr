import type { IdentityProofSource } from '~~/server/utils/identityProof';
import type { OrganisationRecords } from '~~/server/utils/organisations';
import { getAuthTables } from 'better-auth/db';
import { describe, expect, it } from 'vitest';
import * as schema from '~~/server/db/schema';
import { createEmailRecorder } from '~~/server/email/recorder';
import { authOptions } from '~~/server/utils/authOptions';
import { AUTH_SCHEMA_CONTRACT } from '@keepr/nuxt-layer/test/helpers/authSchemaContract';

// The hand-written identity schema, held to the table contract Better Auth derives
// from Keepr Accounts' own options: a bump that breaks it owes a migration.

// The tables do not depend on what an Identity Proof reads or the Audit Record
// writes, so nothing is read or written.
const contract = Object.values(
	getAuthTables(
		authOptions({
			sharedCookieDomain: undefined,
			email: createEmailRecorder(),
			identityProof: {} as IdentityProofSource,
			organisations: {} as OrganisationRecords,
		}),
	),
);

describe('the identity schema', () => {
	it('is the contract of the chosen add-ons’ models', () => {
		expect(contract.map(({ modelName }) => modelName).toSorted()).toEqual([
			'account',
			'invitation',
			'jwks',
			'member',
			'organization',
			'rateLimit',
			'session',
			'user',
			'verification',
		]);
	});

	it.each(AUTH_SCHEMA_CONTRACT)('keeps the rule: %s', (_rule, check) => {
		expect(check(contract, schema)).toEqual([]);
	});
});
