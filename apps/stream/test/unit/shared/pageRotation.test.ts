import { describe, expect, it } from 'vitest';
import {
	msUntilNextRotationFlip,
	pageRotationEdit,
	projectRotationPage,
	rotationAnchorForPage,
	rotationPageCount,
	rotationPageSize,
} from '~~/shared/modules/page-rotation';

// A Page Rotation's pages are the steps of an interval, whose own rules
// `interval.test.ts` holds: here, what a step means as a page.
describe('page rotation projection', () => {
	const ANCHOR = 1_000_000;
	const rotation = { rotationAnchor: ANCHOR, pageDurationMs: 10_000, totalPages: 3 };

	it.each([
		{ at: 'its anchor', now: ANCHOR, page: 1 },
		{ at: 'one page duration on', now: ANCHOR + 10_000, page: 2 },
		{ at: 'the end of its last page, wrapping', now: ANCHOR + 30_000, page: 1 },
	])('shows page $page at $at', ({ now, page }) => {
		expect(projectRotationPage({ ...rotation, now })).toBe(page);
	});

	it('projects from epoch zero when no anchor is stored, so pre-anchor configs rotate deterministically', () => {
		// now = 25s after epoch, 10s pages, 3 pages → 2 full pages elapsed → page 3.
		expect(projectRotationPage({ pageDurationMs: 10_000, totalPages: 3, now: 25_000 })).toBe(3);
	});

	it.each([1, 0])('holds the first page and never flips with %i pages', (totalPages) => {
		const single = { ...rotation, totalPages, now: ANCHOR + 95_000 };
		expect(projectRotationPage(single)).toBe(1);
		expect(msUntilNextRotationFlip(single)).toBeNull();
	});

	it('re-anchors a manual selection so the chosen page is current and holds for one full duration', () => {
		const pageDurationMs = 10_000;
		const totalPages = 4;
		const now = 500_000;

		const anchor = rotationAnchorForPage({ page: 3, pageDurationMs, now });
		const pageAt = (instant: number) =>
			projectRotationPage({
				rotationAnchor: anchor,
				pageDurationMs,
				totalPages,
				now: instant,
			});

		expect(pageAt(now)).toBe(3);
		expect(pageAt(now + pageDurationMs - 1)).toBe(3);
		expect(pageAt(now + pageDurationMs)).toBe(4);
	});

	it('mints integer anchors from a fractional clock estimate', () => {
		// getServerTime() = Date.now() + an RTT-averaged float offset, but the
		// config schema requires an integer — the anchor must round, not fail.
		expect(rotationAnchorForPage({ page: 2, pageDurationMs: 10_000, now: 500_000.4375 })).toBe(
			490_000,
		);
	});

	it('reports the time to the next flip', () => {
		// 25s elapsed of 10s pages → 5s into the third page → 5s until the flip.
		expect(msUntilNextRotationFlip({ ...rotation, rotationAnchor: 0, now: 25_000 })).toBe(5_000);
	});
});

/** A page size is a number of rows, or Auto while absent: every row on one page. */
describe('page rotation page size', () => {
	const declaration = { pageSize: 'cardsPerPage' };

	it.each([
		{
			config: { cardsPerPage: 4 },
			pageSize: 4,
		},
		{ config: {}, pageSize: undefined },
		{
			config: { cardsPerPage: undefined },
			pageSize: undefined,
		},
	])('reads $config as $pageSize', ({ config, pageSize }) => {
		expect(rotationPageSize(declaration, config)).toBe(pageSize);
	});

	it.each([
		{ rowCount: 20, pageSize: 5, pages: 4 },
		{ rowCount: 21, pageSize: 5, pages: 5 },
		{ rowCount: 3, pageSize: 5, pages: 1 },
		{ rowCount: 0, pageSize: 5, pages: 1 },
		{ rowCount: 60, pageSize: undefined, pages: 1 },
		{ rowCount: 0, pageSize: undefined, pages: 1 },
	])('pages $rowCount rows at $pageSize a page into $pages', ({ rowCount, pageSize, pages }) => {
		expect(rotationPageCount(rowCount, pageSize)).toBe(pages);
	});

	it('an edit returning the page size to Auto is a page size edit', () => {
		expect(
			pageRotationEdit(
				declaration,
				{ autoPageEnabled: true },
				{ cardsPerPage: null },
				1_000_000.25,
			),
		).toEqual({ cardsPerPage: null, currentPage: 1, rotationAnchor: 1_000_000 });
	});
});
