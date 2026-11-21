import type { Flight } from '../../utils/guardedSequence';

/**
 * Shared helpers for CRUD store patterns.
 * Provides optimistic update and delete with automatic rollback,
 * wrapping `useAsyncAction` for consistent error handling. A rollback never
 * overwrites what replaced the prediction since: a newer update's, or a reload's.
 */

interface OptimisticUpdateConfig<T, TUpdates extends object = Partial<T>> {
	items: Ref<T[]>;
	id: number;
	updates: TUpdates;
	apiCall: () => Promise<T>;
	errorRef: Ref<string | null>;
	entityLabel: string;
	onSuccess?: () => void;
	/** The lifetime `items` belongs to; once stale, neither the answer nor the rollback lands in it. */
	flight?: Flight;
	/**
	 * Offers the answer to what `items` follows, answering whether it lands. One that
	 * does not is left behind, and the held item answers in its place.
	 */
	admit?: (updated: T) => boolean;
}

interface OptimisticDeleteConfig<T> {
	items: Ref<T[]>;
	id: number;
	apiCall: () => Promise<unknown>;
	errorRef: Ref<string | null>;
	entityLabel: string;
	onSuccess?: () => void;
	/** The lifetime `items` belongs to; once stale, neither the answer nor the rollback lands in it. */
	flight?: Flight;
}

/**
 * Each failed prediction, to what it replaced. A rollback to a prediction that
 * has since failed itself goes on to what that one replaced.
 */
const failedPredictions = new WeakMap<object, object>();

function beforeFailedPredictions<T extends object>(item: T): T {
	let restored = item;
	for (
		let earlier = failedPredictions.get(restored);
		earlier;
		earlier = failedPredictions.get(restored)
	) {
		restored = earlier as T;
	}
	return restored;
}

export function useStoreHelpers() {
	const { executeAction } = useAsyncAction();

	/**
	 * Optimistically updates an item in the list, rolling back on failure.
	 * Applies updates immediately, then confirms via API. On error, restores original.
	 */
	async function optimisticUpdate<T extends { id: number }, TUpdates extends object = Partial<T>>(
		config: OptimisticUpdateConfig<T, TUpdates>,
	): Promise<T | null> {
		const {
			items,
			id,
			updates,
			apiCall,
			errorRef,
			entityLabel,
			onSuccess,
			flight = unguarded,
			admit,
		} = config;

		const index = items.value.findIndex((item) => item.id === id);
		if (index === -1) {
			errorRef.value = `${entityLabel} not found`;
			return null;
		}

		const original = toRaw(items.value[index]!);
		const predicted: T = { ...original, ...updates };
		items.value[index] = predicted;

		let landed = false;
		const result = await executeAction(
			async () => {
				const updated = await apiCall();
				if (flight.stale) return updated;
				const idx = items.value.findIndex((item) => item.id === id);
				if (admit && !admit(updated)) {
					return idx === -1 ? updated : items.value[idx]!;
				}
				if (idx !== -1) items.value[idx] = updated;
				landed = true;
				return updated;
			},
			{
				errorRef,
				flight,
				onError: () => {
					failedPredictions.set(predicted, original);
					// Only this update's prediction is rolled back: a newer one, or a reload, stands.
					const idx = items.value.findIndex((item) => item.id === id);
					if (idx !== -1 && toRaw(items.value[idx]) === predicted) {
						items.value[idx] = beforeFailedPredictions(original);
					}
				},
			},
		);
		// Outside the request: a throwing callback is the caller's fault, not a failed write.
		if (landed) onSuccess?.();
		return result;
	}

	/**
	 * Optimistically removes an item from the list, rolling back on failure.
	 * Splices the item out immediately, then confirms via API. On error, re-inserts.
	 */
	async function optimisticDelete<T extends { id: number }>(
		config: OptimisticDeleteConfig<T>,
	): Promise<boolean | null> {
		const { items, id, apiCall, errorRef, entityLabel, onSuccess, flight = unguarded } = config;

		const index = items.value.findIndex((item) => item.id === id);
		if (index === -1) {
			errorRef.value = `${entityLabel} not found`;
			return null;
		}

		const removed = structuredClone(toRaw(items.value[index]!));
		items.value.splice(index, 1);

		const result = await executeAction(
			async () => {
				await apiCall();
				return true;
			},
			{
				errorRef,
				flight,
				onError: () => {
					// A reload during the call may have brought the item back already.
					if (items.value.some((item) => item.id === id)) return;
					items.value.splice(Math.min(index, items.value.length), 0, removed);
				},
			},
		);
		// Outside the request: a throwing callback is the caller's fault, not a failed delete.
		if (result && flight.current) onSuccess?.();
		return result;
	}

	return { optimisticUpdate, optimisticDelete };
}
