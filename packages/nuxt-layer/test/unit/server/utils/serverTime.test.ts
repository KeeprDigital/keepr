import { afterEach, expect, it, vi } from 'vitest';
import { readServerTime } from '../../../../server/utils/serverTime';

// A device corrects its clock drift against this reading, so it is the
// server's clock in epoch milliseconds, the unit every schedule is stamped in.

afterEach(() => vi.useRealTimers());

it('answers the server clock in epoch milliseconds', () => {
	vi.useFakeTimers({ now: new Date('2026-11-12T10:00:00.250Z') });

	expect(readServerTime()).toEqual({ serverTime: 1_794_477_600_250 });
});
