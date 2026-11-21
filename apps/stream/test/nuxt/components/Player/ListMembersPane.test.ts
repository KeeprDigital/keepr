import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, reactive } from 'vue';
import ListMembersPane from '~/components/Player/ListMembersPane.vue';

const eventStore = reactive({ eventId: 1 });
const playerListStore = {
	addMembers: vi.fn(),
	batchRemoveMembers: vi.fn(),
	reorderMembers: vi.fn(),
	loadListMembers: vi.fn(),
};

mockNuxtImport('useEventStore', () => () => eventStore);
mockNuxtImport('usePlayerListStore', () => () => playerListStore);

const UButtonStub = defineComponent({
	emits: ['click'],
	template:
		'<button type="button" v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
});

const VueDraggableStub = defineComponent({
	props: {
		modelValue: { type: Array, required: true },
	},
	template: '<div><slot /></div>',
});

async function mountPane(
	allPlayers: Array<{ id: number; name: string }> = [
		{ id: 1, name: 'Alice' },
		{ id: 2, name: 'Bob' },
	],
	initialMemberIds: number[] = [1],
) {
	return mount(ListMembersPane, {
		props: {
			listId: 5,
			allPlayers: allPlayers as any,
			initialMemberIds,
		},
		global: {
			stubs: {
				UButton: UButtonStub,
				UCheckbox: defineComponent({
					emits: ['update:modelValue'],
					template:
						'<input type="checkbox" v-bind="$attrs" @click="$emit(\'update:modelValue\', true)" />',
				}),
				UInput: true,
				UDropdownMenu: true,
				UIcon: true,
				VueDraggable: VueDraggableStub,
			},
		},
	});
}

describe('playerListMembersPane', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		playerListStore.addMembers.mockResolvedValue({ success: true });
		playerListStore.batchRemoveMembers.mockResolvedValue({ success: true });
		playerListStore.reorderMembers.mockResolvedValue({ success: true });
		playerListStore.loadListMembers.mockResolvedValue([1, 2]);
	});

	it('does not continue or report success after a member mutation returns null', async () => {
		const wrapper = await mountPane();
		await wrapper.get('[aria-label="Add Bob to list"]').trigger('click');
		playerListStore.addMembers.mockResolvedValueOnce(null);

		await expect((wrapper.vm as any).save()).rejects.toThrow('Failed to add list members');

		expect(playerListStore.reorderMembers).not.toHaveBeenCalled();
		expect(playerListStore.loadListMembers).not.toHaveBeenCalled();
	});

	// One add or removal request takes at most 500 Players; a List may hold more.
	it.each([
		{ change: 'adds', members: false, header: 0, action: 'Add 1201', write: 'addMembers' as const },
		{
			change: 'removes',
			members: true,
			header: 1,
			action: 'Remove 1201',
			write: 'batchRemoveMembers' as const,
		},
	])('$change more than 500 members in requests of 500 at most', async (row) => {
		const players = Array.from({ length: 1201 }, (_, index) => ({
			id: index + 1,
			name: `Player ${index + 1}`,
		}));
		const wrapper = await mountPane(players, row.members ? players.map((player) => player.id) : []);
		const selectAll = wrapper.findAll('input[type="checkbox"]:not([aria-label])')[row.header]!;
		await selectAll.trigger('click');
		await wrapper.get(`button[label="${row.action}"]`).trigger('click');

		await (wrapper.vm as any).save();

		expect(playerListStore[row.write].mock.calls.map(([, , ids]) => ids.length)).toEqual([
			500, 500, 201,
		]);
	});
});
