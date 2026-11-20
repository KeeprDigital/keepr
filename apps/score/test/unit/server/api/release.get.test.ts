import { expect, it, vi } from 'vitest';

// The layer's Release reading, served where a deploy's verify reads it. Its refusals are the layer's.

const runtimeConfig = { release: { app: 'score', version: '0.4.0', commit: 'abc1234' } };
const event = { path: '/api/release' };

vi.stubGlobal('defineEventHandler', (handler: unknown) => handler);
vi.stubGlobal('useRuntimeConfig', (from: unknown) => (from === event ? runtimeConfig : {}));

const readRelease = (await import('../../../../server/api/release.get')).default as unknown as (
	from: typeof event,
) => unknown;

it('answers the Release this request’s runtime config records', () => {
	expect(readRelease(event)).toEqual({ app: 'score', version: '0.4.0', commit: 'abc1234' });
});
