/**
 * What a local checkout has to be given before the surfaces that read it stop
 * refusing, and the one line a dev server says when it has not been.
 *
 * `.env` is the whole of local configuration since #412. Nuxt loads it into
 * `process.env` before a module's `setup` runs, so `nuxt dev` has these names in
 * hand by the time runtimeConfig is read, and `pnpm preview` stages the same file
 * next to the generated wrangler config, where a previewed Worker reads it
 * (`scripts/stage-preview-secrets.mjs`).
 *
 * Nothing here is for signing in. Who a request belongs to is asked of Keepr
 * Accounts, which holds the sign-in secret (ADR-0112), and locally of the
 * Accounts Stand-in every launcher starts (ADR-0113, ADR-0141): no name in any
 * file turns that question on or off.
 *
 * The names, their surfaces and the notice live here, apart from the Nuxt module
 * that prints it, so all of it can be exercised without booting Nuxt, and so the
 * `.mjs` acceptance harnesses can import the one list rather than restate it
 * (`scripts/graphics-acceptance/local-configuration.mjs`).
 */

const NAME = /^[A-Z_]\w*$/i;
const EXPORT_PREFIX = /^export\s+/;

/**
 * The `NUXT_` names an ordinary local checkout has to be given before the surfaces
 * that read them stop refusing, and the whole of what the #130 notice is asserting.
 *
 * These are `.env.example`'s assignments minus everything in
 * `LOCALLY_OPTIONAL_NUXT_NAMES` below, which carries its own reasons per name.
 * `localConfiguration.test.ts` pins the partition against the example file, so a new
 * name added there fails until someone decides which side it belongs on.
 */
export const LOCALLY_REQUIRED_NUXT_NAMES = ['NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY'] as const;

export type LocallyRequiredNuxtName = (typeof LOCALLY_REQUIRED_NUXT_NAMES)[number];

/**
 * Deliberately optional, and named here so the partition above is legible.
 *
 * The Ably key is the only one here that reaches a third party. An empty one is
 * the expected state of a checkout that never claimed to have realtime, and #223
 * already owns saying so: the integration suite skips the tests that reach the
 * service and announces the reason once. Requiring it would warn every such
 * checkout about a secret it does not need.
 *
 * The three Melee names are optional in a different key: nothing refuses at boot
 * without them, so a notice naming them would be telling a developer to go and find
 * a secret they do not need yet.
 *
 * The two bandai-keepr names are optional because nothing refuses without them:
 * a One Piece Event's card features say "card data unavailable" instead (ADR-0057).
 */
export const LOCALLY_OPTIONAL_NUXT_NAMES = [
	'NUXT_ABLY_API_KEY',
	'NUXT_MELEE_CREDENTIAL_ENCRYPTION_KEY',
	'NUXT_MELEE_CREDENTIAL_KEY_VERSION',
	'NUXT_MELEE_CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS',
	'NUXT_BANDAI_KEEPR_API_KEY',
	'NUXT_BANDAI_KEEPR_API_URL',
] as const;

/**
 * What stops working per name, in the words its own refusal uses.
 *
 * One entry per required name, so the notice can name the surfaces belonging to the
 * names that are *actually* missing. The strings are the refusals' own, so a reader
 * can match notice to response: "…so Screen Output asset capabilities are
 * unavailable" begins with the environment name itself, as a
 * `ServiceConfigurationError` does (#321). `satisfies` makes a new required name a
 * type error here rather than a name whose surface the notice silently omits.
 */
export const LOCAL_NUXT_NAME_SURFACES = {
	NUXT_SCREEN_OUTPUT_CAPABILITY_SIGNING_KEY: 'Screen Output asset capabilities',
} as const satisfies Record<LocallyRequiredNuxtName, string>;

/**
 * Which required names the environment cannot supply.
 *
 * Blank counts as missing, because that is how the readers count it (`signingKey`
 * rejects the empty string), and because the likeliest way to hold a populated
 * `.env` full of blanks is `cp .env.example .env`, which is advice this very
 * notice gives.
 */
export function missingLocalNuxtNames(
	env: Record<string, string | undefined>,
): LocallyRequiredNuxtName[] {
	return LOCALLY_REQUIRED_NUXT_NAMES.filter((name) => (env[name] ?? '').trim().length === 0);
}

/**
 * A list of names or surfaces, as a sentence rather than as a join: the serial
 * comma separates the items from a conjunction inside one of them. Two items keep
 * the plain `a and b`.
 */
export function sentenceList(items: readonly string[], conjunction: 'and' | 'or'): string {
	if (items.length <= 2) return items.join(` ${conjunction} `);

	return `${items.slice(0, -1).join(', ')}, ${conjunction} ${items[items.length - 1]}`;
}

/**
 * #130: what a dev server without local configuration is about to do, said before it
 * does it.
 *
 * `.env` is gitignored, so a fresh `git worktree` does not inherit it from the
 * checkout it was branched from. The names keep their empty defaults, and the
 * surfaces that need them answer 503 individually, each naming its own variable.
 * None of them says the checkout has no local configuration, which is the one fact
 * that turns several unrelated-looking 503s into one copy step.
 *
 * **Keyed on the names, not on the file**: Nuxt loads `.env` into `process.env`
 * before a module's `setup` runs, and a notice that can be false where it fires is
 * worse than no notice.
 *
 * A warning rather than a refusal. Plenty of this application runs without these
 * names, which is exactly what a worktree opened to read the UI wants, so failing
 * the boot would trade an obscure 503 for an obstruction.
 */
export function localConfigurationBootNotice(missing: readonly LocallyRequiredNuxtName[]): string {
	const names =
		missing.length === 1
			? `${missing[0]}, so it keeps its empty default`
			: `${sentenceList(missing, 'or')}, so they keep their empty default`;

	// Only the surfaces belonging to the names that are missing, and only the
	// "each says so on its own" clause when there is more than one to say it.
	const surfaces = missing.map((name) => LOCAL_NUXT_NAME_SURFACES[name]);
	const consequence =
		surfaces.length === 1
			? `${surfaces[0]} answer 503 without naming this as the cause`
			: `${sentenceList(surfaces, 'and')} answer 503, and each says so on its own without naming a common cause`;

	return (
		`Nothing in this checkout sets ${names}: ${consequence}. ` +
		'A fresh git worktree is the usual way to arrive here — .env is gitignored, so a new checkout ' +
		'inherits none of it from the one it was branched from, and a copied .env.example carries the names ' +
		'with empty values. Fix: copy .env in from the checkout you branched from, or fill in .env.example. ' +
		'See README.md → Local configuration.'
	);
}

/**
 * Whether this process should say anything about local configuration at all.
 *
 * Two silences, both structural rather than incidental.
 *
 * A build must not: there these names come from real secrets rather than from a
 * checkout, and advice about copying a local file into place is advice a build has
 * no way to act on and no business acting on.
 *
 * The integration suite must not, even though it runs `nuxt dev`. It pins the names
 * it needs into the environment of the *server child* it spawns, not into its own,
 * so its own process is short of every one of them by design and a notice keyed on
 * what this process can supply would fire on every run of a suite behaving exactly
 * as intended. The suite already announces itself to `nuxt.config.ts`; this reads
 * the same announcement.
 *
 * `=== 'true'` rather than "is set", because that is what `STREAM_KEEPR_INTEGRATION`
 * means everywhere else it is read (`nuxt.config.ts`, `server/plugins/error-handler.ts`)
 * and the suite sets exactly that.
 */
export function announcesLocalConfiguration(context: LocalConfigurationContext): boolean {
	return context.dev && context.env.STREAM_KEEPR_INTEGRATION !== 'true';
}

export interface LocalConfigurationContext {
	dev: boolean;
	env: Record<string, string | undefined>;
}

/** Reads a dotenv body — `.env`, or the copy of it staged for a previewed Worker. */
export function parseDotenv(source: string): Map<string, string> {
	const values = new Map<string, string>();
	for (const rawLine of source.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith('#')) continue;
		const separator = line.indexOf('=');
		if (separator <= 0) continue;
		const name = line.slice(0, separator).replace(EXPORT_PREFIX, '').trim();
		if (!NAME.test(name)) continue;
		values.set(name, unquote(line.slice(separator + 1).trim()));
	}
	return values;
}

function unquote(value: string): string {
	const quote = value[0];
	if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote))
		return value.slice(1, -1);
	// An unquoted value ends at an inline comment, as dotenv reads it.
	return value.replace(/\s+#.*$/, '');
}

/**
 * The one line this run should log, or nothing.
 *
 * Here rather than in the Nuxt module because the module is meant to be an adapter
 * with nothing left to get wrong. A pure function of the environment can be pinned;
 * four lines inside `defineNuxtModule` cannot.
 *
 * The silence is checked first and separately from what is missing. A build and the
 * integration suite are both short of these names in their own process, so gating on
 * `missing` alone would warn them on every run.
 */
export function localConfigurationLogLine(
	context: LocalConfigurationContext,
): { level: 'warn'; message: string } | undefined {
	if (!announcesLocalConfiguration(context)) return undefined;

	const missing = missingLocalNuxtNames(context.env);
	if (missing.length === 0) return undefined;

	return {
		level: 'warn',
		message: localConfigurationBootNotice(missing),
	};
}
