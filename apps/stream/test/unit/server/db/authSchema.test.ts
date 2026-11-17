import { getAuthTables } from 'better-auth/db';
import { describe, expect, it } from 'vitest';
import * as authSchema from '~~/server/db/schema/auth';
import { authStaticOptions } from '~~/server/utils/authOptions';
import { AUTH_SCHEMA_CONTRACT } from '@keepr/nuxt-layer/test/helpers/authSchemaContract';

// The hand-maintained auth schema, held to the table contract Better Auth derives
// from this installation's options (#393): a bump that breaks it owes a migration.

const contract = Object.values(getAuthTables(authStaticOptions));

describe('the Better Auth schema', () => {
	it('is the contract of every Better Auth model', () => {
		expect(contract.map(({ modelName }) => modelName).toSorted()).toEqual([
			'account',
			'rateLimit',
			'session',
			'user',
			'verification',
		]);
	});

	it.each(AUTH_SCHEMA_CONTRACT)('keeps the rule: %s', (_rule, check) => {
		expect(check(contract, authSchema)).toEqual([]);
	});
});
