import { afterEach, describe, expect, it } from 'vitest';
import { effectScope } from 'vue';
import { text } from '~~/test/helpers/graphicsComposition';
import { featureMatchLayoutEditing } from '~~/test/nuxt/helpers/graphicsEditorHosts';
import { useGraphicsEditorKeyboard } from '~/composables/useGraphicsEditorKeyboard';
import { GRAPHICS_EDITOR_SHORTCUTS } from '~/modules/graphics/editor/shortcuts';
import { previewZoomShortcut } from '~/modules/graphics/previewControls';

/*
 * The shortcut list shows only keys the editor answers: each chord it lists, as
 * typed, is taken by the editor's keyboard or the preview's zoom.
 */

/** Rows the editor's pointer gestures or its layer list answer, not a window key. */
const ANSWERED_ELSEWHERE = new Set([
	'Rename the focused layer (or double-click it)',
	'Add or remove a layer from the selection',
	'Select a run of layers in the list',
	'Keep aspect ratio (rotate in 15° steps)',
	'Turn off snapping',
	'Zoom the preview',
	'Pan the preview (or middle-drag)',
]);

const MODIFIERS: Record<string, keyof KeyboardEventInit> = {
	'⌘': 'metaKey',
	'⇧': 'shiftKey',
	'⌥': 'altKey',
};

const NAMED_KEYS: Record<string, { key: string; code: string }> = {
	'⌫': { key: 'Backspace', code: 'Backspace' },
	'←↑↓→': { key: 'ArrowLeft', code: 'ArrowLeft' },
	']': { key: ']', code: 'BracketRight' },
	'[': { key: '[', code: 'BracketLeft' },
	Esc: { key: 'Escape', code: 'Escape' },
};

/** The keydown a chord as the list shows it types, on a US layout. */
function keydownFor(keys: readonly string[]): KeyboardEventInit {
	const init: KeyboardEventInit = { bubbles: true, cancelable: true };
	for (const key of keys) {
		const modifier = MODIFIERS[key];
		if (modifier) {
			(init as Record<string, unknown>)[modifier] = true;
			continue;
		}
		const named = NAMED_KEYS[key];
		const digit = /^\d$/.test(key);
		Object.assign(
			init,
			named ?? { key: key.toLowerCase(), code: digit ? `Digit${key}` : `Key${key}` },
		);
	}
	return init;
}

const chords = GRAPHICS_EDITOR_SHORTCUTS.filter(({ label }) => !ANSWERED_ELSEWHERE.has(label));

describe("the graphics editor's shortcut list", () => {
	let scope: ReturnType<typeof effectScope> | undefined;
	afterEach(() => scope?.stop());

	function editorAnswering() {
		const editing = featureMatchLayoutEditing({
			writable: true,
			items: [text('a', { x: 10, y: 10 }), text('b', { x: 500, y: 300 })],
		});
		editing.editor.select(editing.layer('a'));
		scope = effectScope();
		scope.run(() => useGraphicsEditorKeyboard(editing.editor, 'feature-match-overlay'));
	}

	it.each(chords.map((row) => [row.keys.join(''), row.label, row.keys] as const))(
		'%s (%s) is answered',
		(_, __, keys) => {
			editorAnswering();
			const init = keydownFor(keys);
			const event = new KeyboardEvent('keydown', init);

			window.dispatchEvent(event);
			const zoom = previewZoomShortcut({
				key: init.key!,
				code: init.code,
				metaKey: !!init.metaKey,
				ctrlKey: false,
				shiftKey: !!init.shiftKey,
				altKey: !!init.altKey,
			});

			expect(event.defaultPrevented || zoom !== null).toBe(true);
		},
	);

	it('names only rows the window keys above leave out', () => {
		const listed = new Set<string>(GRAPHICS_EDITOR_SHORTCUTS.map(({ label }) => label));
		expect([...ANSWERED_ELSEWHERE].filter((label) => !listed.has(label))).toEqual([]);
	});
});
