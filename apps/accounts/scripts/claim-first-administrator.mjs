/**
 * Offers the first Keepr Administrator role to an email address (ADR-0115).
 *
 * Writes a one-time First Administrator Claim into the identity database, and
 * its making into the Audit Record, then prints the link that claims it. No
 * request can write one: this runs with the operator's own Cloudflare access.
 * Nothing is written once a Keepr Administrator exists.
 *
 *   pnpm claim-first-administrator <email>                      # the local database
 *   pnpm claim-first-administrator <email> --remote <database>  # a deployed one
 */

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

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

function main(argv) {
	const [email, flag, database] = argv;
	const remote = flag === '--remote';
	if (!email || (flag !== undefined && (!remote || !database))) {
		console.error('Usage: pnpm claim-first-administrator <email> [--remote <database>]');
		process.exit(2);
	}
	const claimId = randomBytes(32).toString('base64url');
	const statements = firstAdministratorClaimSql({
		email,
		claimId,
		at: new Date(),
		by: userInfo().username,
	});
	const target = remote
		? [database, '--remote']
		: ['DB', '--local', '--config', 'wrangler.dev.jsonc'];
	execFileSync('pnpm', ['exec', 'wrangler', 'd1', 'execute', ...target, '--command', statements], {
		stdio: 'inherit',
	});
	const origin = remote ? 'https://accounts.keepr.digital' : 'http://localhost:3000';
	console.info(
		[
			'',
			`If no Keepr Administrator existed, a claim for ${email} is written. Claim it at:`,
			'',
			`  ${firstAdministratorClaimLink(origin, claimId)}`,
			'',
			'It works once, and only until a Keepr Administrator exists.',
		].join('\n'),
	);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main(process.argv.slice(2));
