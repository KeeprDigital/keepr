import type { EffectScope } from 'vue';
import { CLOSE_REFUSED } from '@keepr/realtime/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { socketRealtimeRig } from '~~/test/helpers/realtimeSocketFake';
import { SCREEN_MODE_REREAD_MS, useScreenModeFreshness } from '~/modules/screen-mode/freshness';

/**
 * Screen Mode Data Freshness's wiring to the realtime transport over an Event's
 * object. Its rules are tested at its home, on a stand-in transport
 * (`screenModeFreshness.test.ts`); these say the transport's own signals reach
 * it: a message, and a refusal standing where a token wait did (ADR-0137).
 */

// The client transport itself, on the rig's socket: the shared setup's never connects.
vi.unmock('@keepr/realtime/client');

const EVENT = 'event:1';

const scopes: EffectScope[] = [];

function harness() {
	const rig = socketRealtimeRig();
	const read = vi.fn(async () => `read ${read.mock.calls.length}`);
	const scope = effectScope();
	scopes.push(scope);
	const freshness = scope.run(() =>
		useScreenModeFreshness<string>({
			hearing: () => ({ channel: EVENT, dependsOn: { 'player:updated': true } }),
			source: () => 'standings',
			read,
			initialData: 'none',
			errorMessage: 'Failed to read',
			realtime: rig.realtime,
		}),
	)!;
	return { ...rig, read, freshness };
}

describe('Screen Mode Data Freshness, on the realtime transport over an Event’s object', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		scopes.splice(0).forEach((scope) => scope.stop());
		vi.useRealTimers();
	});

	it('re-reads on its channel’s first attach, then on a message it depends on', async () => {
		const { read, open, freshness } = harness();
		await vi.advanceTimersByTimeAsync(0);
		expect(read).toHaveBeenCalledTimes(1);

		const socket = await open(1, EVENT);
		await vi.advanceTimersByTimeAsync(0);
		expect(read).toHaveBeenCalledTimes(2);

		socket.publish(EVENT, 'player:updated', { eventId: 1 });
		await vi.advanceTimersByTimeAsync(0);

		expect(read).toHaveBeenCalledTimes(3);
		expect(freshness.data.value).toBe('read 3');
	});

	it('re-reads on the slow cadence while its Event refuses it, and once it is let in, then stops', async () => {
		const { read, socket, clock, freshness } = harness();
		(await socket()).drop(CLOSE_REFUSED);
		await vi.advanceTimersByTimeAsync(0);
		expect(read).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS);
		expect(read).toHaveBeenCalledTimes(2);

		// Let in: the refusal ends, and the attach says its continuity was lost.
		await clock.advance(5000);
		(await socket()).letIn().attach(EVENT);
		await vi.advanceTimersByTimeAsync(0);
		expect(read).toHaveBeenCalledTimes(3);
		expect(freshness.data.value).toBe('read 3');

		await vi.advanceTimersByTimeAsync(SCREEN_MODE_REREAD_MS * 3);
		expect(read).toHaveBeenCalledTimes(3);
	});
});
