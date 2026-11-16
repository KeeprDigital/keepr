import type { Ref } from 'vue';

export interface FrameClock {
	/** The instant last read: by `start`, and on every frame while in motion. */
	now: Readonly<Ref<number>>;
	/** Read the instant now and run frames from it; one already running keeps its frame. */
	start: () => void;
	/** Stop running frames, leaving `now` where it was last read. */
	stop: () => void;
}

/**
 * The clock motion is read on: one instant, read again on every animation
 * frame while anything read at it is in motion, and left where it stopped once
 * all of it is settled. Where a clock projection waits for its next change
 * (`useClockProjection`), motion changes on every frame, so this asks each
 * frame whether there is still any.
 *
 * `read` answers the instant, server time for anything two renderings must
 * agree on. `inMotion` answers whether anything at that instant is still
 * moving: a settled clock schedules no frames, and its owner starts it again
 * when what it reads changes. A start costs one frame when nothing moves. It
 * runs on the client only, and stops with the scope that owns it.
 */
export function useFrameClock(read: () => number, inMotion: (now: number) => boolean): FrameClock {
	const now = ref(read());
	let frame: number | null = null;

	function stop() {
		if (frame !== null && import.meta.client) cancelAnimationFrame(frame);
		frame = null;
	}

	function advance() {
		now.value = read();
		if (!inMotion(now.value)) {
			stop();
			return;
		}
		frame = requestAnimationFrame(advance);
	}

	function start() {
		if (!import.meta.client) return;
		now.value = read();
		if (frame === null) frame = requestAnimationFrame(advance);
	}

	onScopeDispose(stop);

	return {
		now: readonly(now),
		start,
		stop,
	};
}
