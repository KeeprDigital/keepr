import type { Component } from 'vue';
import type { VueWrapper } from '@vue/test-utils';
import { mountSuspended } from '@nuxt/test-utils/runtime';
import { afterEach, describe, expect, it } from 'vitest';
import ConfirmActionModal from '../../../../app/components/UI/ConfirmActionModal.vue';
import ConfirmDeleteModal from '../../../../app/components/UI/ConfirmDeleteModal.vue';
import UnsavedChangesModal from '../../../../app/components/UI/UnsavedChangesModal.vue';
import { nuxtUiStubs } from '../../helpers/nuxtUiStubs';

const mounted: VueWrapper[] = [];

afterEach(() => {
	for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

/** Opened as `useOverlay` opens it: `open` falls through to the modal at its root. */
async function openModal(modal: Component, props: Record<string, unknown> = {}) {
	const wrapper = await mountSuspended(modal, {
		props: { open: true, ...props },
		global: { stubs: nuxtUiStubs },
	});
	mounted.push(wrapper);
	return wrapper;
}

function button(wrapper: VueWrapper, name: string) {
	const found = wrapper
		.findAll('button')
		.find((candidate) => (candidate.attributes('aria-label') ?? candidate.text()) === name);
	if (!found) throw new Error(`No button named ${name}`);
	return found;
}

function pressEnter(init: KeyboardEventInit = {}) {
	document.body.dispatchEvent(
		new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }),
	);
}

const modals = [
	['ConfirmActionModal', ConfirmActionModal, 'Confirm'],
	['ConfirmDeleteModal', ConfirmDeleteModal, 'Delete'],
	['UnsavedChangesModal', UnsavedChangesModal, 'Discard Changes'],
] as const;

/** Each closes with `true` only for its confirming action; every way out answers `false`. */
describe.each(modals)('%s', (_name, modal, confirmLabel) => {
	it.each([
		[confirmLabel, true],
		['Cancel', false],
		['Close', false],
	])('closes with its answer when %s is pressed', async (label, answer) => {
		const wrapper = await openModal(modal);

		await button(wrapper, label).trigger('click');

		expect(wrapper.emitted('close')).toEqual([[answer]]);
	});

	it('confirms on Enter', async () => {
		const wrapper = await openModal(modal);

		pressEnter();

		expect(wrapper.emitted('close')).toEqual([[true]]);
	});
});

describe.each([
	['ConfirmActionModal', ConfirmActionModal, 'Confirm'],
	['ConfirmDeleteModal', ConfirmDeleteModal, 'Delete'],
] as const)('%s while its action is loading', (_name, modal, confirmLabel) => {
	it('cannot be cancelled, shows its confirm busy and ignores Enter', async () => {
		const wrapper = await openModal(modal, { loading: true });

		expect(button(wrapper, 'Cancel').attributes('disabled')).toBeDefined();
		expect(button(wrapper, confirmLabel).attributes('aria-busy')).toBe('true');
		pressEnter();
		expect(wrapper.emitted('close')).toBeUndefined();
	});
});

describe('what the modals say', () => {
	it.each([
		['a confirmation by default', ConfirmActionModal, {}, ['Confirm', 'Are you sure?']],
		[
			'a confirmation in its own words',
			ConfirmActionModal,
			{
				title: 'Reset Screen',
				message: 'Reset the Screen?',
				description: 'Its layout returns to the default.',
				confirmLabel: 'Reset',
			},
			['Reset Screen', 'Reset the Screen?', 'Its layout returns to the default.', 'Reset'],
		],
		[
			'a delete of an unnamed item',
			ConfirmDeleteModal,
			{},
			['Confirm Delete', 'delete this item?', 'cannot be undone'],
		],
		[
			'a delete naming its item',
			ConfirmDeleteModal,
			{ title: 'Delete Screen', itemName: 'Main Stage' },
			['Delete Screen', 'Are you sure you want to delete "Main Stage"?'],
		],
		['unsaved changes', UnsavedChangesModal, {}, ['Unsaved Changes', 'Your changes will be lost.']],
	])('names %s', async (_label, modal, props, texts) => {
		const wrapper = await openModal(modal, props);

		for (const text of texts) expect(wrapper.text()).toContain(text);
	});
});
