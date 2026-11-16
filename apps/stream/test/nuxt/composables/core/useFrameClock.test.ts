import type { EffectScope } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A frame clock reads its instant on every animation frame while anything read
// at it is in motion, and schedules none once all of it is settled.
describe('useFrameClock', () => {
	let instant: number;
	let moving: boolean;
	let frames: Map<number, FrameRequestCallback>;
	let scope: EffectScope;

	/** Run the one frame waiting, as the browser would. */
	function runFrame() {
		const [[id, callback] = []] = frames;
		if (id === undefined || !callback) throw new Error('no frame is waiting');
		frames.delete(id);
		callback(0);
	}

	function frameClock() {
		return scope.run(() =>
			useFrameClock(
				() => instant,
				() => moving,
			),
		)!;
	}

	beforeEach(() => {
		instant = 1_000_000;
		moving = true;
		frames = new Map();
		let nextId = 0;
		vi.stubGlobal(
			'requestAnimationFrame',
			vi.fn((callback: FrameRequestCallback) => {
				frames.set(++nextId, callback);
				return nextId;
			}),
		);
		vi.stubGlobal(
			'cancelAnimationFrame',
			vi.fn((id: number) => frames.delete(id)),
		);
		scope = effectScope();
	});

	afterEach(() => {
		scope.stop();
		vi.unstubAllGlobals();
	});

	it('holds the instant it was made at, and runs no frame until started', () => {
		const clock = frameClock();

		expect(clock.now.value).toBe(1_000_000);
		expect(frames.size).toBe(0);
	});

	it('reads the instant again on every frame while in motion', () => {
		const clock = frameClock();
		clock.start();

		instant = 1_000_016;
		runFrame();
		expect(clock.now.value).toBe(1_000_016);

		instant = 1_000_032;
		runFrame();
		expect(clock.now.value).toBe(1_000_032);
		expect(frames.size).toBe(1);
	});

	it('reads the instant as it settles, then runs no more frames', () => {
		const clock = frameClock();
		clock.start();

		instant = 1_000_500;
		moving = false;
		runFrame();

		expect(clock.now.value).toBe(1_000_500);
		expect(frames.size).toBe(0);
	});

	it('asks whether anything moves at the instant it has just read', () => {
		const asked: number[] = [];
		const clock = scope.run(() =>
			useFrameClock(
				() => instant,
				(now) => {
					asked.push(now);
					return false;
				},
			),
		)!;
		clock.start();

		instant = 1_000_250;
		runFrame();

		expect(asked).toEqual([1_000_250]);
	});

	it('reads the instant at once when started, running one frame however often it is started', () => {
		const clock = frameClock();
		clock.start();

		instant = 1_000_100;
		clock.start();

		expect(clock.now.value).toBe(1_000_100);
		expect(frames.size).toBe(1);
	});

	it('runs frames again when started once settled', () => {
		const clock = frameClock();
		clock.start();
		moving = false;
		runFrame();

		moving = true;
		instant = 1_002_000;
		clock.start();
		expect(clock.now.value).toBe(1_002_000);

		instant = 1_002_016;
		runFrame();
		expect(clock.now.value).toBe(1_002_016);
		expect(frames.size).toBe(1);
	});

	it.each([
		{
			ending: 'it is stopped',
			end: (clock: { stop: () => void }) => clock.stop(),
		},
		{
			ending: 'its scope ends',
			end: () => scope.stop(),
		},
	])('runs no more frames once $ending', ({ end }) => {
		const clock = frameClock();
		clock.start();

		end(clock);

		expect(frames.size).toBe(0);
	});
});
