import { useLocalStorage } from '@vueuse/core';
import { isPlainRecord } from '../../../shared/utils/plainObject';

function rememberedOpenState(storageKey: string): Ref<Record<string, boolean>> {
	try {
		// Read on mount, so a server render and the first client render agree.
		return useLocalStorage<Record<string, boolean>>(storageKey, {}, { initOnMounted: true });
	} catch {
		// A browser that refuses storage still collapses for this view.
		return ref({});
	}
}

/**
 * Which collapsible panels are open, remembered per browser under one storage
 * key, by panel id.
 *
 * A convenience, never configuration: an unknown or unreadable entry falls back
 * to the panel's own default.
 */
export function useRememberedOpenState(storageKey: string) {
	const stored = rememberedOpenState(storageKey);

	/** What storage holds, as panel ids to booleans: anything else there is no memory. */
	function remembered(): Record<string, unknown> {
		const value: unknown = stored.value;
		return isPlainRecord(value) ? value : {};
	}

	function isOpen(id: string, defaultOpen = true): boolean {
		const entry = remembered()[id];
		return typeof entry === 'boolean' ? entry : defaultOpen;
	}

	function setOpen(id: string, open: boolean) {
		stored.value = { ...(remembered() as Record<string, boolean>), [id]: open };
	}

	return { isOpen, setOpen };
}
