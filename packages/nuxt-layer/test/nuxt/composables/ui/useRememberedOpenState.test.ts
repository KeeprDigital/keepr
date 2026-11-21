import { enableAutoUnmount, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';

const KEY = 'test-remembered-open-state';

/** A panel list rendering each panel's open state, as a page would. */
async function mountPanels(stored: string | null) {
	if (stored === null) localStorage.removeItem(KEY);
	else localStorage.setItem(KEY, stored);
	let state!: ReturnType<typeof useRememberedOpenState>;
	const renderErrors: unknown[] = [];
	const wrapper = mount(
		defineComponent({
			setup() {
				state = useRememberedOpenState(KEY);
				return () => h('p', `${state.isOpen('players')}:${state.isOpen('rounds', false)}`);
			},
		}),
		{ global: { config: { errorHandler: (error) => void renderErrors.push(error) } } },
	);
	// It reads storage once mounted.
	await nextTick();
	return { wrapper, state, renderErrors };
}

enableAutoUnmount(afterEach);

describe('useRememberedOpenState', () => {
	afterEach(() => localStorage.removeItem(KEY));

	it.each([
		['nothing', null, 'true:false'],
		['a remembered entry', '{"players":false,"rounds":true}', 'false:true'],
		['a literal null', 'null', 'true:false'],
		['a list', '[true]', 'true:false'],
		['an entry that is not a boolean', '{"players":"no"}', 'true:false'],
	])('renders panel defaults or memory over storage holding %s', async (_, stored, rendered) => {
		const { wrapper, renderErrors } = await mountPanels(stored);

		expect(renderErrors).toEqual([]);
		expect(wrapper.text()).toBe(rendered);
	});

	it('remembers a panel opened over unreadable storage', async () => {
		const { wrapper, state } = await mountPanels('null');

		state.setOpen('rounds', true);
		await nextTick();

		expect(wrapper.text()).toBe('true:true');
		expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ rounds: true });
	});
});
