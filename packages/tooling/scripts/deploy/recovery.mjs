/**
 * The D1 recovery point (ADR-0125): before a deploy's first remote change, each
 * D1 database the descriptor migrates must answer its current D1 Time Travel
 * bookmark, the point a failed migration is restored to. The deploy refuses
 * without one, in every Environment and however it was started, and the app's
 * marker records each bookmark, so the run that failed says where to restore.
 *
 * Migration and promotion are separate Cloudflare operations, not one
 * transaction: this replaces the word an operator once typed to say a recovery
 * point existed.
 */

/** One token, as D1 returns it: no space, nothing on a second line. */
const BOOKMARK = /^\S+$/;

/**
 * @param {{
 *   release: import('./release.mjs').Release,
 *   environment: string,
 *   bookmark: (binding: string) => string,
 *   log: (line: string) => void,
 * }} options `bookmark`: the binding's current Time Travel bookmark, read from
 *   Cloudflare (`wrangler d1 time-travel info <binding> --json`); it throws
 *   when it cannot be read.
 * @returns {Record<string, string>} the marker's `recovery` field, `<binding>=<bookmark>`
 *   for each database; nothing when the app has none
 */
export function recordRecoveryPoints({ release, environment, bookmark, log }) {
	const { app, descriptor } = release;
	const wranglerEnv = descriptor.environments?.[environment]?.wranglerEnv;
	const points = descriptor.databases.map(({ binding }) => {
		let point;
		try {
			point = bookmark(binding);
		} catch (error) {
			throw new Error(
				`no D1 recovery point for ${app}'s ${binding} in ${environment}: ${/** @type {Error} */ (error).message}. Nothing was changed.`,
				{ cause: error },
			);
		}
		if (typeof point !== 'string' || !BOOKMARK.test(point))
			throw new Error(
				`no D1 recovery point for ${app}'s ${binding} in ${environment}: Time Travel answered no bookmark. Nothing was changed.`,
			);
		log(
			`D1 recovery point for ${binding}: bookmark ${point}. To restore it, from apps/${app}: ` +
				`wrangler d1 time-travel restore ${binding} --bookmark=${point} --config ${descriptor.worker.config}` +
				(wranglerEnv === undefined ? '' : ` --env ${wranglerEnv}`),
		);
		return `${binding}=${point}`;
	});
	return points.length === 0 ? {} : { recovery: points.join(' ') };
}
