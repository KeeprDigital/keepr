/**
 * Where server time is read, and what it answers. The layer registers no
 * route, so every app that shows server time (`useServerTime`, and every Clock
 * Projection on it) registers this path with `readServerTime`.
 */
export const SERVER_TIME_PATH = '/api/time';

/** The server's clock in epoch milliseconds, the unit every schedule is stamped in. */
export interface ServerTimeReading {
	serverTime: number;
}
