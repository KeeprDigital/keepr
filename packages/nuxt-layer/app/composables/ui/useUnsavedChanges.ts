import type { ComputedRef, InjectionKey, Ref } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRouter } from 'vue-router';
import { LazyUIUnsavedChangesModal } from '#components';

const UNSAVED_CHANGES_KEY: InjectionKey<{
	registerDirtyState: (dirty: Ref<boolean> | ComputedRef<boolean>) => () => void;
}> = Symbol('unsaved-changes');

interface UseUnsavedChangesReturn {
	isDirty: ComputedRef<boolean>;
	registerDirtyState: (dirty: Ref<boolean> | ComputedRef<boolean>) => () => void;
	bypassGuard: () => void;
}

/** A guard asked before navigation; `to` and `from` are absent when the asker has no route. */
type NavigationDiscardGuard = (
	to?: RouteLocationNormalized,
	from?: RouteLocationNormalized,
) => Promise<boolean>;

const navigationGuards = new Set<NavigationDiscardGuard>();

/**
 * True once navigation may leave every guarded page and open guarded modal:
 * none holds an unsaved edit, or the operator chose to discard each.
 *
 * An app's route middleware that resets state an edit saves against asks this
 * first. A `router.beforeEach`, or a page's `onBeforeRouteUpdate`, runs after
 * that middleware, so "Keep editing" would return to a form whose state is
 * already gone.
 */
export async function confirmDiscardBeforeNavigation(
	to?: RouteLocationNormalized,
	from?: RouteLocationNormalized,
): Promise<boolean> {
	for (const confirmDiscard of [...navigationGuards]) {
		if (!(await confirmDiscard(to, from))) return false;
	}
	return true;
}

/**
 * Page-level composable for managing unsaved changes navigation guards.
 *
 * Asks before a dirty page is left or shown for other route params, never for
 * a query or hash change on the same path; each navigation is asked once,
 * however many guards consult it. Sets up the route guards, the browser's
 * beforeunload listener, and provides registerDirtyState to child components.
 * `bypassGuard` lets the next navigation through unasked; once that navigation
 * settles, landed or cancelled, the guard asks again.
 *
 * @example
 * // In page component
 * useUnsavedChanges();
 */
export function useUnsavedChanges(): UseUnsavedChangesReturn {
	const dirtyStates = ref<Set<Ref<boolean> | ComputedRef<boolean>>>(new Set());
	const shouldBypass = ref(false);

	const isDirty = computed(() => [...dirtyStates.value].some((s) => unref(s)));

	const registerDirtyState = (dirty: Ref<boolean> | ComputedRef<boolean>) => {
		dirtyStates.value.add(dirty);
		return () => dirtyStates.value.delete(dirty);
	};

	const overlay = useOverlay();
	const confirmModal = overlay.create(LazyUIUnsavedChangesModal);

	/** Each navigation's answer, so the guards that consult it ask the operator once. */
	const answers = new WeakMap<RouteLocationNormalized, Promise<boolean>>();

	const confirmNavigation: NavigationDiscardGuard = (to, from) => {
		if (to && from && to.path === from.path) return Promise.resolve(true);
		if (shouldBypass.value || !isDirty.value) return Promise.resolve(true);
		const asked = to && answers.get(to);
		if (asked) return asked;
		const answer = confirmModal.open({}).result.then((confirmed: unknown) => confirmed === true);
		if (to) answers.set(to, answer);
		return answer;
	};

	onBeforeRouteLeave((to, from) => confirmNavigation(to, from));
	onBeforeRouteUpdate((to, from) => confirmNavigation(to, from));
	navigationGuards.add(confirmNavigation);
	onScopeDispose(() => navigationGuards.delete(confirmNavigation));
	const stopBypassReset = useRouter()?.afterEach(() => {
		shouldBypass.value = false;
	});
	if (stopBypassReset) onScopeDispose(stopBypassReset);

	useBeforeUnloadGuard(isDirty);

	// Provide registration function for child components
	provide(UNSAVED_CHANGES_KEY, { registerDirtyState });

	const bypassGuard = () => {
		shouldBypass.value = true;
	};

	return { isDirty, registerDirtyState, bypassGuard };
}

/**
 * Unsaved-changes guard for a form in an overlay modal.
 *
 * An overlay modal renders outside the page that opened it, so it can neither
 * register with the page's guard nor use `onBeforeRouteLeave`. It guards
 * itself instead: navigation while it is open (asked by an app's route
 * middleware through `confirmDiscardBeforeNavigation`), a browser unload, and —
 * through `confirmDiscard` — its own close.
 *
 * @example
 * const { confirmDiscard } = useModalUnsavedChanges(isDirty);
 * async function handleCancel() {
 *   if (await confirmDiscard())
 *     emit('close');
 * }
 */
export function useModalUnsavedChanges(dirty: Ref<boolean> | ComputedRef<boolean>) {
	const overlay = useOverlay();
	const confirmModal = overlay.create(LazyUIUnsavedChangesModal);

	/** True once the operator may lose the edit: nothing unsaved, or they chose to discard it. */
	async function confirmDiscard(): Promise<boolean> {
		if (!unref(dirty)) return true;
		return (await confirmModal.open({}).result) === true;
	}

	navigationGuards.add(confirmDiscard);
	onUnmounted(() => navigationGuards.delete(confirmDiscard));
	useBeforeUnloadGuard(computed(() => unref(dirty)));

	return { confirmDiscard };
}

/** Asks the browser to confirm an unload while `isDirty` holds. */
function useBeforeUnloadGuard(isDirty: ComputedRef<boolean>) {
	const handleBeforeUnload = (e: BeforeUnloadEvent) => {
		if (isDirty.value) {
			e.preventDefault();
			// Legacy browsers require returnValue
			e.returnValue = '';
			return '';
		}
	};

	onMounted(() => {
		window.addEventListener('beforeunload', handleBeforeUnload);
	});

	onUnmounted(() => {
		window.removeEventListener('beforeunload', handleBeforeUnload);
	});
}

/**
 * Component-level helper to register dirty state with parent page's guard.
 *
 * Automatically registers the dirty state with the parent page's unsaved changes guard
 * and unregisters on component unmount.
 *
 * @param dirty - A ref or computed ref indicating if the component has unsaved changes
 *
 * @example
 * // In form component
 * const { isDirty } = useForm({ initialData: ... });
 * useRegisterDirtyState(isDirty);
 */
export function useRegisterDirtyState(dirty: Ref<boolean> | ComputedRef<boolean>): void {
	const ctx = inject(UNSAVED_CHANGES_KEY, null);
	if (ctx) {
		const unregister = ctx.registerDirtyState(dirty);
		onUnmounted(unregister);
	}
}
