import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { describe, expect, it } from 'vitest';
import { ref } from 'vue';
import ServerTimeStatus from '../../../../app/components/UI/ServerTimeStatus.vue';
import type { ServerTimeDoubt } from '../../../../app/composables/core/useServerTime';
import { nuxtUiStubs } from '../../helpers/nuxtUiStubs';

const isSynced = ref(true);
const doubt = ref<ServerTimeDoubt | null>(null);

mockNuxtImport('useServerTime', () => () => ({
	isSynced,
	doubt,
	lastSyncedAt: ref(Date.now()),
	serverTimeOffset: ref(120),
}));

async function openStatus() {
	const wrapper = await mountSuspended(ServerTimeStatus, { global: { stubs: nuxtUiStubs } });
	await wrapper.get('button').trigger('click');
	return wrapper;
}

describe('ServerTimeStatus', () => {
	// An offset known to be possibly wrong never reads as synced.
	it.each([
		{
			synced: true,
			reason: null,
			heading: 'Server Time Synced',
			icon: 'i-lucide-clock-3',
			says: 'Clock offset',
		},
		{
			synced: true,
			reason: 'slow-network' as const,
			heading: 'Server Time Uncertain',
			icon: 'i-lucide-clock-alert',
			says: 'answered slowly',
		},
		{
			synced: true,
			reason: 'device-clock-changed' as const,
			heading: 'Server Time Uncertain',
			icon: 'i-lucide-clock-alert',
			says: 'clock was changed',
		},
		{
			synced: false,
			reason: null,
			heading: 'Not Synced',
			icon: 'i-lucide-clock-alert',
			says: 'Using local device time',
		},
	])(
		'reads $heading when synced is $synced and doubted for $reason',
		async ({ synced, reason, heading, icon, says }) => {
			isSynced.value = synced;
			doubt.value = reason;

			const wrapper = await openStatus();

			expect(wrapper.text()).toContain(heading);
			expect(wrapper.text()).toContain(says);
			expect(wrapper.get('[data-icon]').attributes('data-icon')).toBe(icon);
		},
	);
});
