import { describe, expect, it } from 'vitest';
import { transportFailure } from '../../../helpers/transportFailure';

const refused = () =>
	transportFailure({
		status: 409,
		body: { message: 'The Screen is not in Broadcast Graphics mode' },
	});

/** The authority's sentence reaches the reader in place of the transport's status line. */
describe('useReportingAction', () => {
	it.each([
		[
			'a refusal the server wrote a sentence for',
			refused,
			'The Screen is not in Broadcast Graphics mode',
		],
		[
			'a sanitized 5xx, by its status line',
			() => transportFailure({ status: 500, body: { message: 'Internal Server Error' } }),
			'[POST] "/api/…": 500 Internal Server Error',
		],
		[
			'a failure that never reached the server',
			() => new Error('Failed to fetch'),
			'Failed to fetch',
		],
	])('reports %s', async (_label, failure, reported) => {
		const { executeReporting } = useReportingAction();
		const error = ref<string | null>(null);
		let rolledBackWith: unknown;

		const result = await executeReporting(
			async () => {
				throw failure();
			},
			{ errorRef: error, onError: (caught) => (rolledBackWith = caught) },
		);

		expect(result).toBeNull();
		expect(error.value).toBe(reported);
		expect((rolledBackWith as Error).message).toBe(reported);
	});

	it('raises the sentence to a throwError caller, keeping the raw failure as its cause', async () => {
		const { executeReporting } = useReportingAction();
		const failure = refused();

		const raised = executeReporting(
			async () => {
				throw failure;
			},
			{ throwError: true },
		);

		await expect(raised).rejects.toMatchObject({
			message: 'The Screen is not in Broadcast Graphics mode',
			cause: failure,
		});
	});

	it('answers a successful action as it is', async () => {
		const { executeReporting } = useReportingAction();
		const loading = ref(false);

		await expect(executeReporting(async () => 'done', { loadingRef: loading })).resolves.toBe(
			'done',
		);
		expect(loading.value).toBe(false);
	});
});
