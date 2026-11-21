import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { createMemoryHistory, createRouter, RouterView } from 'vue-router';

// The page guard on a real router: which navigations it asks about, and what a bypass covers.

/** The operator's answers to the confirmation, in order: true discards. */
const answers: boolean[] = [];
const openModal = vi.fn(() => ({ result: Promise.resolve(answers.shift() ?? false) }));
mockNuxtImport('useOverlay', () => () => ({ create: () => ({ open: openModal }) }));

let page: ReturnType<typeof useUnsavedChanges>;

const EditPage = defineComponent({
	setup() {
		page = useUnsavedChanges();
		return () => h('p', 'editing');
	},
});

async function mountAt(path: string) {
	const router = createRouter({
		history: createMemoryHistory(),
		routes: [
			{ path: '/', component: { render: () => h('p', 'home') } },
			{ path: '/event/:eventId', component: EditPage },
		],
	});
	await router.push(path);
	await router.isReady();
	mount(RouterView, { global: { plugins: [router] } });
	return router;
}

enableAutoUnmount(afterEach);

describe('useUnsavedChanges', () => {
	beforeEach(() => {
		answers.length = 0;
		openModal.mockClear();
	});

	it('is dirty while any registered dirty state is, until it is unregistered', async () => {
		await mountAt('/event/1');
		const first = ref(false);
		const second = ref(false);
		page.registerDirtyState(first);
		const unregister = page.registerDirtyState(second);
		expect(page.isDirty.value).toBe(false);

		second.value = true;
		expect(page.isDirty.value).toBe(true);

		unregister();
		expect(page.isDirty.value).toBe(false);
	});

	it.each([
		['to another page, and stays when refused', '/', false, '/event/1'],
		['to another page, and leaves when confirmed', '/', true, '/'],
		['for other route params, and stays when refused', '/event/2', false, '/event/1'],
	])('asks before a dirty page navigates %s', async (_, target, confirmed, landed) => {
		const router = await mountAt('/event/1');
		page.registerDirtyState(ref(true));
		answers.push(confirmed);

		await router.push(target);

		expect(openModal).toHaveBeenCalledOnce();
		expect(router.currentRoute.value.fullPath).toBe(landed);
	});

	it.each([
		['a clean page leaves', '/', false],
		['a query-only change on a dirty page lands', '/event/1?tab=players', true],
	])('does not ask when %s', async (_, target, dirty) => {
		const router = await mountAt('/event/1');
		page.registerDirtyState(ref(dirty));

		await router.push(target);

		expect(openModal).not.toHaveBeenCalled();
		expect(router.currentRoute.value.fullPath).toBe(target);
	});

	it('lets a bypassed navigation through unasked', async () => {
		const router = await mountAt('/event/1');
		page.registerDirtyState(ref(true));

		page.bypassGuard();
		await router.push('/');

		expect(openModal).not.toHaveBeenCalled();
		expect(router.currentRoute.value.fullPath).toBe('/');
	});

	it.each([
		['was cancelled', true, '/event/1'],
		['changed params on the page it stayed on', false, '/event/2'],
	])('asks again once a bypassed navigation %s', async (_, cancelled, stayedAt) => {
		const router = await mountAt('/event/1');
		page.registerDirtyState(ref(true));
		const removeCancel = router.beforeEach(() => !cancelled);

		page.bypassGuard();
		await router.push('/event/2');
		removeCancel();
		await router.push('/event/3');

		expect(openModal).toHaveBeenCalledOnce();
		expect(router.currentRoute.value.fullPath).toBe(stayedAt);
	});

	it('asks once for a navigation that middleware asked about first', async () => {
		const router = await mountAt('/event/1');
		page.registerDirtyState(ref(true));
		router.beforeEach((to, from) => confirmDiscardBeforeNavigation(to, from));
		answers.push(true);

		await router.push('/');

		expect(openModal).toHaveBeenCalledOnce();
		expect(router.currentRoute.value.fullPath).toBe('/');
	});

	it('answers middleware for a param change before the page is updated', async () => {
		const router = await mountAt('/event/1');
		page.registerDirtyState(ref(true));
		const middlewareRan = vi.fn();
		router.beforeEach(async (to, from) => {
			if (!(await confirmDiscardBeforeNavigation(to, from))) return false;
			middlewareRan();
		});

		await router.push('/event/2');

		expect(middlewareRan).not.toHaveBeenCalled();
		expect(router.currentRoute.value.fullPath).toBe('/event/1');
	});
});
