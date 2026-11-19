/**
 * The headers the hand-off itself reads. Apart from the rest of it, because the
 * dev server's own process names one too, and loads nothing of a Worker.
 */

/**
 * Marks the request the Worker beside `nuxt dev` puts to the port, with a
 * secret made for one run of the dev server. The built Worker reads no header:
 * it marks its own request in memory (`mark.ts`).
 */
export const HAND_OFF_HEADER = 'x-realtime-hand-off';

/** Set on the port's answer, so a page the app serves at the port's path is not taken for one. */
export const PORT_ANSWER_HEADER = 'x-realtime-port-answer';
