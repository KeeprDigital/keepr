/**
 * Page Rotation — the deterministic projection of a paginated Screen Mode's
 * current page from its Rotation Anchor and server time.
 *
 * Owned by no client and computed identically by every rendering (Screen
 * Output, Program Monitor, operator settings), the same discipline the
 * broadcast-graphics phase projection follows: current state is a pure
 * function of persisted state and the synchronized server instant, so
 * renderings agree by construction and nothing writes as the rotation runs.
 *
 * Its pages are the steps of an interval (`shared/utils/interval.ts`): this
 * module owns what a step means here, a page among a count of them.
 */

import { intervalAnchorForStep, projectInterval } from '../../utils/interval';

export interface PageRotationInputs {
	/**
	 * The server timestamp the rotation counts from. A missing anchor projects
	 * from epoch zero — still deterministic and identical across renderings —
	 * so configs written before the anchor existed rotate without migration.
	 */
	rotationAnchor?: number;
	pageDurationMs: number;
	totalPages: number;
	/** The current synchronized server instant (never a raw local clock). */
	now: number;
}

/** The interval a Page Rotation's pages are counted on: one page duration a step, from its anchor. */
function rotationInterval(inputs: PageRotationInputs) {
	return projectInterval(inputs.rotationAnchor ?? 0, inputs.pageDurationMs, inputs.now);
}

/** The 1-based page a Page Rotation shows at the given instant. */
export function projectRotationPage(inputs: PageRotationInputs): number {
	if (inputs.totalPages <= 1) return 1;
	return (rotationInterval(inputs).step % inputs.totalPages) + 1;
}

/**
 * The Rotation Anchor an operator surface writes when a page is manually
 * selected mid-rotation: the chosen page becomes current immediately and
 * holds for one full page duration before rotation continues in order.
 *
 * Rounded, because the synchronized clock estimate is an RTT-averaged float
 * while a stored anchor is an integer timestamp.
 */
export function rotationAnchorForPage(inputs: {
	page: number;
	pageDurationMs: number;
	now: number;
}): number {
	return Math.round(intervalAnchorForStep(inputs.page - 1, inputs.pageDurationMs, inputs.now));
}

/**
 * Milliseconds until the projection next changes page, or null when nothing
 * rotates. A rendering schedules exactly one re-evaluation at this boundary
 * instead of polling.
 */
export function msUntilNextRotationFlip(inputs: PageRotationInputs): number | null {
	if (inputs.totalPages <= 1) return null;
	return rotationInterval(inputs).nextStepInMs;
}

/**
 * What a paginated Screen Mode Definition declares about its Page Rotation
 * (`pageRotation` in `shared/screenModes.ts`): the config field holding how
 * many rows a page holds, a number, or Auto while a mode that lets it be
 * absent holds none. The rotation's own fields are the shared
 * `pageRotationShape`, which every declaring mode's config carries.
 */
export interface PageRotationDeclaration {
	readonly pageSize: string;
}

/**
 * How many rows a page holds in a paginated mode's config, read from the field
 * its declaration names, or undefined while it is Auto. The Screen Mode
 * Definitions fail to compile unless that field is a number, or an optional one.
 */
export function rotationPageSize(
	declaration: PageRotationDeclaration,
	config: object,
): number | undefined {
	return (config as Record<string, unknown>)[declaration.pageSize] as number | undefined;
}

/**
 * How many pages a Page Rotation turns `rowCount` rows into: at least one, and
 * exactly one at an Auto page size, which holds every row. The one count every
 * rendering and operator surface pages by, so they agree by construction (#780).
 */
export function rotationPageCount(rowCount: number, pageSize: number | undefined): number {
	return pageSize === undefined ? 1 : Math.max(1, Math.ceil(rowCount / pageSize));
}

/**
 * The Rotation Anchor that restarts a Page Rotation from page 1 now: enabling
 * auto-page, or an edit changing the rotation's shape while it runs. Page 1's
 * anchor is the instant itself, whatever the page duration.
 */
export function restartedRotationAnchor(now: number): number {
	return rotationAnchorForPage({ page: 1, pageDurationMs: 0, now });
}

/**
 * The write an operator edit of a paginated mode's config makes. An edit
 * changing the rotation's shape, its page size or page duration, restarts it
 * from page 1: while auto-page is on, the Rotation Anchor moves to now. A page
 * size edit also resets the manually selected page to 1, since every page
 * then holds different rows. Any other edit is written as it is; nothing else
 * re-anchors (ADR-0009).
 *
 * The one place that decides which edits are shape changes, for every mode
 * declaring a Page Rotation.
 */
export function pageRotationEdit<Patch extends object>(
	declaration: PageRotationDeclaration,
	rotation: { autoPageEnabled: boolean },
	patch: Patch,
	now: number,
): Patch & { currentPage?: number; rotationAnchor?: number } {
	const resizesPages = declaration.pageSize in patch;
	if (!resizesPages && !('autoPageIntervalMs' in patch)) return patch;
	return {
		...patch,
		...(resizesPages ? { currentPage: 1 } : {}),
		...(rotation.autoPageEnabled
			? {
					rotationAnchor: restartedRotationAnchor(now),
				}
			: {}),
	};
}
