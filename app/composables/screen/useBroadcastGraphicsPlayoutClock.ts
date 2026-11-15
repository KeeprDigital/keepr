import type { MaybeRefOrGetter, Ref } from 'vue';
import type { BroadcastGraphicConfig, GraphicChannelConfig } from '~~/shared/types/graphics';

/**
 * The one authoritative instant a Broadcast Graphics surface projects playout at.
 *
 * What is on program, which values are showing, and whether any of them are media
 * are all answers to the same question — "at *when*?" — and reading two of them at
 * two instants is how a surface disagrees with the output it is watching. Every
 * projection a component makes must read this one instant.
 *
 * Each caller holds its own clock; what is shared is the authority it advances
 * from — the session store's serverNow — and the rule for when it runs, which
 * is a frame clock's (`useFrameClock`).
 *
 * The clock advances while anything is in flight and stops when everything is
 * settled, because a settled phase cannot change and an operator's browser has
 * better things to do sixty times a second. It restarts whenever the Broadcast
 * Graphics Live Session moves on, or the stored graphics or channels change.
 */
export function useBroadcastGraphicsPlayoutClock(
	screenId: MaybeRefOrGetter<number>,
	graphics: MaybeRefOrGetter<readonly BroadcastGraphicConfig[]>,
	channels?: MaybeRefOrGetter<readonly GraphicChannelConfig[] | undefined>,
): Readonly<Ref<number>> {
	const sessionStore = useBroadcastGraphicsLiveSessionStore();

	/** In flight while the Live Session has a phase to project, or a Social Profile Rotation runs. */
	const clock = useFrameClock(
		() => sessionStore.serverNow(),
		now => Object.keys(sessionStore.animationProjection(
			toValue(screenId),
			toValue(graphics),
			now,
			toValue(channels),
		)).length > 0 || sessionStore.hasActiveSocialProfileRotation(toValue(screenId), toValue(graphics)),
	);

	// The stored graphics and channels restart it too: a looping recipe saved onto
	// a graphic resting on air starts motion with no session command. A change that
	// moves nothing costs one frame, which stops the clock again.
	watch(
		[
			() => {
				const session = sessionStore.sessions.get(toValue(screenId));
				return session
					? `${session.id}:${session.sequence}:${sessionStore.clockSynchronized}`
					: null;
			},
			() => toValue(graphics),
			() => toValue(channels),
		],
		() => clock.start(),
		{ immediate: true },
	);

	return clock.now;
}
