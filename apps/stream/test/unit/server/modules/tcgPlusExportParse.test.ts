import { describe, expect, it } from 'vitest';
import { parseTcgPlusExport } from '~~/server/modules/tcgplus-import/parse';
import { TCGPLUS_EXPORT_HEADER, tcgPlusExport } from '~~/test/helpers/tcgPlusExport';

// Reading a Bandai TCG+ deck list export (ADR-0074): its home. The route's
// tests prove the import wiring; each rule of the file's reading is here.

/**
 * One entry in a real export's layout (`test/helpers/tcgPlusExport.ts`): a Leader
 * row whose 種類 says `Leader`, a Character row, a member number with leading
 * zeros. Real exports hold personal data, so names and numbers are made up.
 */
const REAL_LAYOUT = [
	TCGPLUS_EXPORT_HEADER,
	'1203,0012345678,Nami Fan,10,OP11-041,Nami,1,Blue,Leader,,Special',
	'1203,0012345678,Nami Fan,10,OP11-054,Kaido,4,Blue,Character,1000,Strike',
].join('\r\n');

const player = { memberNumber: '001', nickname: 'Zoro', leader: 'OP01-001', cards: [] };

describe('parseTcgPlusExport', () => {
	it("reads an entry's member number, Nickname, Leader and cards from the export's own layout", () => {
		expect(parseTcgPlusExport(`﻿${REAL_LAYOUT}`)).toEqual([
			{
				memberNumber: '0012345678',
				nickname: 'Nami Fan',
				leaderNumber: 'OP11-041',
				entries: [
					{ number: 'OP11-041', quantity: 1 },
					{ number: 'OP11-054', quantity: 4 },
				],
			},
		]);
	});

	it.each([
		{
			case: 'a Leader row after its cards',
			player: { ...player, cards: [['OP01-030', 4]] as const, leaderAt: 'last' as const },
			leader: 'OP01-001',
			entries: [
				{ number: 'OP01-030', quantity: 4 },
				{ number: 'OP01-001', quantity: 1 },
			],
		},
		{
			case: 'no Leader row',
			player: { ...player, leader: null, cards: [['OP01-030', 4]] as const },
			leader: null,
			entries: [{ number: 'OP01-030', quantity: 4 }],
		},
		{
			case: 'a card over two printing rows',
			player: { ...player, cards: [['OP01-030', 4]] as const, splitPrintings: ['OP01-030'] },
			leader: 'OP01-001',
			entries: [
				{ number: 'OP01-001', quantity: 1 },
				{ number: 'OP01-030', quantity: 4 },
			],
		},
	])('reads $case', ({ player: exported, leader, entries }) => {
		const [entry] = parseTcgPlusExport(tcgPlusExport([exported], { lineEnding: '\r\n' }));

		expect(entry).toMatchObject({ leaderNumber: leader, entries });
	});

	it('keeps each entry apart by member number, in the order the file first names them', () => {
		const entries = parseTcgPlusExport(
			tcgPlusExport([
				{ ...player, memberNumber: '002', nickname: 'Second' },
				{ ...player, memberNumber: '001', nickname: 'First' },
			]),
		);

		expect(entries.map((entry) => entry.nickname)).toEqual(['Second', 'First']);
	});

	it('cuts a Nickname to 100 characters, never through one', () => {
		const [entry] = parseTcgPlusExport(
			tcgPlusExport([{ ...player, nickname: `${'a'.repeat(99)}😀b` }]),
		);

		expect(entry!.nickname).toBe('a'.repeat(99));
	});

	it.each([
		{ case: 'a missing column', text: 'チームID,会員番号\n1,2', refusal: 'has no' },
		{
			case: 'a blank Nickname',
			text: tcgPlusExport([{ ...player, nickname: ' ' }]),
			refusal: 'has no Nickname',
		},
		{
			case: 'an unreadable quantity',
			text: `${TCGPLUS_EXPORT_HEADER}\n1,001,Zoro,10,OP01-001,Zoro,x,Red,Leader,,Slash`,
			refusal: 'no readable quantity',
		},
		{
			case: 'an unreadable card number',
			text: `${TCGPLUS_EXPORT_HEADER}\n1,001,Zoro,10,nope,Zoro,1,Red,Leader,,Slash`,
			refusal: 'no readable card number',
		},
		{
			case: 'a field left open',
			text: `${TCGPLUS_EXPORT_HEADER}\n1,001,"Zoro,10`,
			refusal: 'inside a quoted field',
		},
		{ case: 'no rows', text: TCGPLUS_EXPORT_HEADER, refusal: 'holds no players' },
	])('refuses $case', ({ text, refusal }) => {
		expect(() => parseTcgPlusExport(text)).toThrow(
			expect.objectContaining({
				code: 'TCGPLUS_EXPORT_INVALID',
				message: expect.stringContaining(refusal),
			}),
		);
	});
});
