/**
 * Offers the first Keepr Administrator role to an email address (ADR-0115).
 *
 * Writes a one-time First Administrator Claim into the identity database, and
 * its making into the Audit Record, then prints the link that claims it. No
 * request can write one: this runs with the operator's own Cloudflare access.
 * Nothing is written once a Keepr Administrator exists.
 *
 *   pnpm claim-first-administrator <email>                                    # the local database
 *   pnpm claim-first-administrator <email> --remote <database>                # production's
 *   pnpm claim-first-administrator <email> --remote <database> --env staging  # another Environment's
 *
 * A deployed database is reached through `wrangler.jsonc`, which names each
 * Environment's account (ADR-0130); the link is that Installation's, from `deploy.jsonc`.
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { parseJsonc } from '@keepr/tooling/scripts/jsonc.mjs';

const USAGE =
	'Usage: pnpm claim-first-administrator <email> [--remote <database> [--env <environment>]]';
const LOCAL_ORIGIN = 'http://localhost:3000';

const ADDRESS = /^[^\s@'"\\;]+@[^\s@'"\\;]+\.[^\s@'"\\;]+$/;

/** A string as an SQLite literal. */
function literal(value) {
	return `'${value.replaceAll("'", "''")}'`;
}

/** The test, in SQL, that no Keepr Administrator exists: no User holds the `admin` role. */
const NO_KEEPR_ADMINISTRATOR =
	"NOT EXISTS (SELECT 1 FROM user WHERE (',' || role || ',') LIKE '%,admin,%')";

/**
 * The statements that write a claim for `email` and its making, both conditional
 * on no Keepr Administrator existing, so they write nothing once one does.
 *
 * @param {{ email: string, claimId: string, at: Date, by: string }} claim
 * @returns {string}
 */
export function firstAdministratorClaimSql({ email, claimId, at, by }) {
	const address = email.trim().toLowerCase();
	if (!ADDRESS.test(address)) throw new Error(`${email} is not an email address`);
	const detail = JSON.stringify({ email: address, by });
	return [
		`INSERT INTO firstAdministratorClaim (id, email, created_at)
			SELECT ${literal(claimId)}, ${literal(address)}, ${at.getTime()}
			WHERE ${NO_KEEPR_ADMINISTRATOR};`,
		`INSERT INTO auditRecord (id, at, actor_user_id, action, detail)
			SELECT ${literal(randomBytes(16).toString('hex'))}, ${at.getTime()}, NULL,
				'first-administrator-claim.made', ${literal(detail)}
			WHERE EXISTS (SELECT 1 FROM firstAdministratorClaim WHERE id = ${literal(claimId)});`,
	].join('\n');
}

/** The page that claims it, the claim in the fragment so no request line carries it. */
export function firstAdministratorClaimLink(origin, claimId) {
	return `${origin}/first-administrator#claim=${encodeURIComponent(claimId)}`;
}

/**
 * Where the command writes, from its flags: the `wrangler d1 execute` database
 * arguments, and the origin of the claim page that database's Installation serves.
 *
 * @param {string[]} flags what follows the email: none, or `--remote <database>`
 *   and, for an Environment other than production, `--env <environment>`
 * @returns {{ database: string[], origin: string }}
 */
export function firstAdministratorClaimTarget(flags) {
	const [remote, database, envFlag, env, ...rest] = flags;
	if (remote === undefined)
		return { database: ['DB', '--local', '--config', 'wrangler.dev.jsonc'], origin: LOCAL_ORIGIN };
	const envNamed = envFlag === undefined || (envFlag === '--env' && Boolean(env));
	if (remote !== '--remote' || !database || !envNamed || rest.length > 0) throw new Error(USAGE);
	/** @type {{ environments: Record<string, { url: string, wranglerEnv?: string }> }} */
	const descriptor = parseJsonc(readFileSync(new URL('../deploy.jsonc', import.meta.url), 'utf8'));
	const installation = Object.values(descriptor.environments).find(
		(environment) => environment.wranglerEnv === env,
	);
	if (!installation)
		throw new Error(`Keepr Accounts has no Installation in ${env}: deploy.jsonc names none.`);
	return {
		database: [
			database,
			'--remote',
			'--config',
			'wrangler.jsonc',
			...(env === undefined ? [] : ['--env', env]),
		],
		origin: new URL(installation.url).origin,
	};
}

function main(argv) {
	const [email, ...flags] = argv;
	let target;
	try {
		if (!email || email.startsWith('--')) throw new Error(USAGE);
		target = firstAdministratorClaimTarget(flags);
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
		process.exit(2);
	}
	const claimId = randomBytes(32).toString('base64url');
	const statements = firstAdministratorClaimSql({
		email,
		claimId,
		at: new Date(),
		by: userInfo().username,
	});
	execFileSync(
		'pnpm',
		['exec', 'wrangler', 'd1', 'execute', ...target.database, '--command', statements],
		{ stdio: 'inherit' },
	);
	console.info(
		[
			'',
			`If no Keepr Administrator existed, a claim for ${email} is written. Claim it at:`,
			'',
			`  ${firstAdministratorClaimLink(target.origin, claimId)}`,
			'',
			'It works once, and only until a Keepr Administrator exists.',
		].join('\n'),
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
