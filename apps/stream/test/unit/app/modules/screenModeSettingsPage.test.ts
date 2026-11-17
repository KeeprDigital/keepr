import type { SettingsPageField } from '~/modules/screen-mode/settingsPage';
import type { ScreenSettingsContext } from '~~/shared/screenModeConfigs/fields';
import { describe, expect, it } from 'vitest';
import {
	fieldOptions,
	fieldPatch,
	fieldValue,
	settingsPageCards,
} from '~/modules/screen-mode/settingsPage';

/** The Deck List settings page's field at `key` ("sideboard.view"), as `config` shows it. */
function shownField(config: Record<string, unknown>, key: string): SettingsPageField {
	const context: ScreenSettingsContext = { config, event: { game: 'mtg' } };
	const row = settingsPageCards('deck', context)
		.flatMap((card) => card.sections)
		.flatMap((section) => section.rows)
		.find((candidate) => candidate.key === key);
	if (row?.kind !== 'field') throw new Error(`${key} is not shown`);
	return row.entry;
}

const stacked = { view: 'stack' } as const;

// A sideboard stacks only as the strip beside the mainboard (ADR-0054): elsewhere
// its View offers no Stack and shows the grid drawn, and its stored stack is kept.
describe("the Deck List sideboard's View", () => {
	it.each([
		['beside the mainboard', {}, ['grid', 'stack', 'list']],
		['below the mainboard', { sideboardPlacement: 'below' }, ['grid', 'list']],
		['shown alone', { board: 'sideboard' }, ['grid', 'list']],
	])('offers, %s, the views it draws', (_where, config, views) => {
		const options = fieldOptions(shownField(config, 'sideboard.view'));

		expect(options?.map((option) => option.value)).toEqual(views);
	});

	it.each([
		['beside the mainboard, as the strip', {}, 'stack'],
		['below the mainboard, as the grid drawn', { sideboardPlacement: 'below' }, 'grid'],
	])('shows a stored stack, %s', (_where, config, shown) => {
		expect(fieldValue(shownField({ ...config, sideboard: stacked }, 'sideboard.view'))).toBe(shown);
	});

	it('keeps a stored stack below the mainboard when another sideboard field is written', () => {
		const sideboard = { ...stacked, alignment: 'center', listColumns: 2 };
		const columns = shownField({ sideboardPlacement: 'below', sideboard }, 'sideboard.columns');

		expect(fieldPatch(columns, 3)).toEqual({ sideboard: { ...sideboard, columns: 3 } });
	});
});
