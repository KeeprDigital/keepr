import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import { nuxtUiStubs } from '@keepr/nuxt-layer/test/nuxt/helpers/nuxtUiStubs';
import ListEditModal from '~/components/Player/ListEditModal.vue';

// Members it could not read are not an empty List: the modal offers no pane to
// save over them, and reads them again on retry.

const members = new Map<number, number[]>();
const unread = new Set<number>();
const loadListMembers = vi.fn(async (_eventId: number, listId: number) => {
	if (loadListMembers.mock.calls.length === 1) {
		unread.add(listId);
		return null;
	}
	unread.delete(listId);
	members.set(listId, [41]);
	return [41];
});
const playerListStore = reactive({
	lists: [{ id: 7, name: 'Top 8', memberCount: 1 }],
	getCachedMemberIds: (listId: number) => members.get(listId),
	memberLoadFailed: (listId: number) => unread.has(listId),
	loadListMembers,
});
mockNuxtImport('usePlayerListStore', () => () => playerListStore);
mockNuxtImport('useEventStore', () => () => reactive({ eventId: 1 }));
mockNuxtImport('usePlayerStore', () => () => reactive({ players: [] }));
mockNuxtImport('useOverlay', () => () => ({ create: vi.fn() }));

describe('player list edit modal', () => {
	it('shows a failed member read with a retry in place of the members', async () => {
		const wrapper = mount(ListEditModal, {
			props: { listId: 7 },
			global: {
				stubs: {
					...nuxtUiStubs,
					UModal: defineComponent({
						template: '<div><slot name="body" /><slot name="footer" /></div>',
					}),
					PlayerListMembersPane: defineComponent({
						props: ['initialMemberIds'],
						template: '<div data-members-pane>{{ initialMemberIds }}</div>',
					}),
				},
			},
		});
		await flushPromises();

		const alert = wrapper.get('[role="alert"]');
		expect(alert.text()).toContain("This list's members could not be loaded.");
		expect(wrapper.find('[data-members-pane]').exists()).toBe(false);

		await alert
			.findAll('button')
			.find((button) => button.text() === 'Retry')!
			.trigger('click');
		await flushPromises();
		expect(wrapper.find('[role="alert"]').exists()).toBe(false);
		expect(wrapper.get('[data-members-pane]').text()).toContain('41');
	});
});
