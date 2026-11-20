import { describe, expect, it, vi } from 'vitest';
import { deferred } from '../../../helpers/deferred';

describe('useAsyncAction', () => {
	it('answers a successful action, loading while it runs and clearing a stale error', async () => {
		const { executeAction } = useAsyncAction();
		const loading = ref(false);
		const error = ref<string | null>('previous error');
		let loadingWhileRunning = false;

		const result = await executeAction(
			async () => {
				loadingWhileRunning = loading.value;
				return 'done';
			},
			{ loadingRef: loading, errorRef: error },
		);

		expect(result).toBe('done');
		expect(loadingWhileRunning).toBe(true);
		expect(loading.value).toBe(false);
		expect(error.value).toBeNull();
	});

	it.each([
		['an Error', new Error('test error'), 'test error'],
		['anything else', 'string error', 'An error occurred'],
	])(
		'answers null for a throw of %s, reporting it and ending the load',
		async (_, thrown, message) => {
			const { executeAction } = useAsyncAction();
			const loading = ref(false);
			const error = ref<string | null>(null);
			const onError = vi.fn();

			const result = await executeAction(
				async () => {
					throw thrown;
				},
				{ loadingRef: loading, errorRef: error, onError },
			);

			expect(result).toBeNull();
			expect(error.value).toBe(message);
			expect(loading.value).toBe(false);
			expect(onError).toHaveBeenCalledOnce();
		},
	);

	it('keeps a shared loading flag up until every request sharing it has settled', async () => {
		const { executeAction } = useAsyncAction();
		const loading = ref(false);
		const first = deferred<string>();
		const second = deferred<string>();

		const firstRun = executeAction(() => first.promise, { loadingRef: loading });
		const secondRun = executeAction(() => second.promise, { loadingRef: loading });
		first.resolve('one');
		await firstRun;
		expect(loading.value).toBe(true);

		second.resolve('two');
		await secondRun;
		expect(loading.value).toBe(false);
	});

	it('lowers the loading flag once a superseded request settles with nothing newer in flight', async () => {
		const { executeAction } = useAsyncAction();
		const loading = ref(false);
		const requests = createGuardedSequence();
		const call = deferred<string>();

		const run = executeAction(() => call.promise, {
			loadingRef: loading,
			flight: requests.begin(),
		});
		requests.supersede();
		call.resolve('late');
		await run;

		expect(loading.value).toBe(false);
	});
});
