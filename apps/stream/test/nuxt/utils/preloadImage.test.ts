import { afterEach, describe, expect, it, vi } from 'vitest';
import { stubImageLoading } from '~~/test/nuxt/helpers/imageLoading';
import { IMAGE_PRELOAD_TIMEOUT_MS, preloadImages } from '~/utils/preloadImage';

const images = stubImageLoading();

describe('preloadImages', () => {
	afterEach(() => {
		images.reset();
		vi.useRealTimers();
	});

	// Each row reaches a different way an image settles: loaded, failed, or never.
	it.each([
		{ row: 'loaded', arrange: () => {}, wait: 0, failed: [] },
		{ row: 'failed', arrange: () => images.fail('a.jpg'), wait: 0, failed: ['a.jpg'] },
		{
			row: 'never settles',
			arrange: () => images.hold('a.jpg'),
			wait: IMAGE_PRELOAD_TIMEOUT_MS,
			failed: ['a.jpg'],
		},
	])('answers an image that $row', async ({ arrange, wait, failed }) => {
		vi.useFakeTimers();
		arrange();
		const answer = vi.fn();
		void preloadImages(['a.jpg', 'b.jpg']).then(answer);

		await vi.advanceTimersByTimeAsync(wait);

		expect(answer).toHaveBeenCalledWith(new Set(failed));
	});

	it('waits for an image still loading short of the timeout', async () => {
		vi.useFakeTimers();
		images.hold('a.jpg');
		const answer = vi.fn();
		void preloadImages(['a.jpg']).then(answer);

		await vi.advanceTimersByTimeAsync(IMAGE_PRELOAD_TIMEOUT_MS - 1);

		expect(answer).not.toHaveBeenCalled();
	});
});
