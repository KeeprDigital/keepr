import type { Component } from 'vue';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { defineComponent } from 'vue';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import AlignmentTokenInput from '~/components/Theme/AlignmentTokenInput.vue';
import AssetTokenInput from '~/components/Theme/AssetTokenInput.vue';
import DimensionTokenInput from '~/components/Theme/DimensionTokenInput.vue';
import SurfaceStyleTokenInput from '~/components/Theme/SurfaceStyleTokenInput.vue';
import TypographyTokenInput from '~/components/Theme/TypographyTokenInput.vue';

/*
 * Each Theme Token input commits a whole value built on the one it holds, or
 * nothing when an edit changes nothing. The shared editors each input wraps
 * are stood in for by what they emit; their own fields are tested at home.
 */

/** A stand-in for a shared editor: it renders its slots and emits what a case sends. */
function editorStub(name: string) {
	return defineComponent({
		name,
		inheritAttrs: false,
		template: '<div><slot name="font" /></div>',
	});
}

const EDITORS = [
	'GraphicsNumberField',
	'GraphicsCompositorSurfaceStyleFields',
	'GraphicsTypographyFields',
	'GraphicsCompositorFontSelectionField',
	'GraphicsAssetFocusPicker',
];

function mountInput(input: Component, props: Record<string, unknown>) {
	return mount(input, {
		props: { label: 'Token', ...props },
		global: {
			stubs: {
				...nuxtUiStubs,
				...Object.fromEntries(EDITORS.map((name) => [name, editorStub(name)])),
			},
		},
	});
}

/** What `editor` sends the input, and every value it committed. */
function send(
	wrapper: ReturnType<typeof mountInput>,
	editor: string,
	event: string,
	...args: unknown[]
) {
	wrapper.findComponent({ name: editor }).vm.$emit(event, ...args);
	return (wrapper.emitted('commit') ?? []).map(([value]) => value);
}

const SOLID = { type: 'solid', color: '#111111' } as const;

describe('a Theme Token input', () => {
	it.each([
		{ case: 'a value above its bound, at the bound', sent: 900, committed: [480] },
		{ case: 'a value below its bound, at the bound', sent: -5, committed: [8] },
		{ case: 'the value it holds, as nothing', sent: 24, committed: [] },
		{ case: 'a cleared field, as nothing', sent: null, committed: [] },
	])('dimension: commits $case', ({ sent, committed }) => {
		const wrapper = mountInput(DimensionTokenInput, {
			modelValue: 24,
			bounds: { min: 8, max: 480 },
		});

		expect(send(wrapper, 'GraphicsNumberField', 'update:modelValue', sent)).toEqual(committed);
	});

	it.each([
		{
			case: 'a new axis, as the whole alignment',
			picked: 'left',
			committed: [{ horizontal: 'left', vertical: 'center' }],
		},
		{ case: 'the axis it holds, as nothing', picked: 'center', committed: [] },
	])('alignment: commits $case', async ({ picked, committed }) => {
		const wrapper = mountInput(AlignmentTokenInput, {
			modelValue: { horizontal: 'center', vertical: 'center' },
		});

		await wrapper.get('[data-token-part="horizontal"]').setValue(picked);

		expect((wrapper.emitted('commit') ?? []).map(([value]) => value)).toEqual(committed);
	});

	it.each([
		{
			case: 'an outline switched on, from the primary text colour',
			held: {},
			edit: { kind: 'outline', patch: { width: 4 } },
			committed: [{ fill: SOLID, fillOpacity: 1, outline: { color: '#ffffff', width: 4 } }],
		},
		{
			case: 'a glow switched on, from the accent',
			held: {},
			edit: { kind: 'glow', patch: {} },
			committed: [
				{ fill: SOLID, fillOpacity: 1, glow: { color: '#0077a3', size: 8, opacity: 0.5 } },
			],
		},
		{
			case: 'an outline switched off, as no outline at all',
			held: { outline: { color: '#abcdef', width: 2 } },
			edit: { kind: 'outline', patch: null },
			committed: [{ fill: SOLID, fillOpacity: 1 }],
		},
		{
			case: 'a cleared outline colour, keeping the one it holds',
			held: { outline: { color: '#abcdef', width: 2 } },
			edit: { kind: 'outline', patch: { color: undefined, width: 3 } },
			committed: [{ fill: SOLID, fillOpacity: 1, outline: { color: '#abcdef', width: 3 } }],
		},
		{
			case: 'a presence switch, as nothing: a token always paints its surface',
			held: {},
			edit: { kind: 'present', present: false },
			committed: [],
		},
	])('surface style: commits $case', ({ held, edit, committed }) => {
		const wrapper = mountInput(SurfaceStyleTokenInput, {
			modelValue: { fill: SOLID, fillOpacity: 1, ...held },
		});

		expect(send(wrapper, 'GraphicsCompositorSurfaceStyleFields', 'edit', edit)).toEqual(committed);
	});

	describe('typography', () => {
		const setting = { weight: 700, lineHeight: 1.2, tracking: 0, case: 'none' } as const;
		const libraryFont = {
			kind: 'asset',
			reference: { assetId: 'a', revisionId: 'r' },
		} as const;

		it.each([
			{
				case: 'a field the shared editor names, under its token name',
				font: { kind: 'application', fontId: 'oswald' },
				editor: 'GraphicsTypographyFields',
				event: 'update',
				sent: { fontWeight: 400, textTransform: 'uppercase' },
				committed: [
					{
						font: { kind: 'application', fontId: 'oswald' },
						...setting,
						weight: 400,
						case: 'uppercase',
					},
				],
			},
			{
				case: 'nothing on choosing a library font, until a revision is picked',
				font: { kind: 'application', fontId: 'oswald' },
				editor: 'GraphicsCompositorFontSelectionField',
				event: 'update:source',
				sent: 'asset',
				committed: [],
			},
			{
				case: 'the default application font on leaving a library font',
				font: libraryFont,
				editor: 'GraphicsCompositorFontSelectionField',
				event: 'update:source',
				sent: 'application',
				committed: [{ font: { kind: 'application', fontId: 'inter' }, ...setting }],
			},
			{
				case: 'the default application font once a library font is cleared',
				font: libraryFont,
				editor: 'GraphicsCompositorFontSelectionField',
				event: 'clear',
				sent: undefined,
				committed: [{ font: { kind: 'application', fontId: 'inter' }, ...setting }],
			},
		])('commits $case', ({ font, editor, event, sent, committed }) => {
			const wrapper = mountInput(TypographyTokenInput, { modelValue: { font, ...setting } });

			expect(send(wrapper, editor, event, sent)).toEqual(committed);
		});
	});

	it.each([
		{
			case: 'none once a held revision is cleared',
			held: { kind: 'image', assetId: 'a', revisionId: 'r' },
			committed: [null],
		},
		{ case: 'nothing for a clear with none held', held: null, committed: [] },
	])('asset: commits $case', ({ held, committed }) => {
		const wrapper = mountInput(AssetTokenInput, { modelValue: held });

		expect(send(wrapper, 'GraphicsAssetFocusPicker', 'update:modelValue', undefined)).toEqual(
			committed,
		);
	});
});
