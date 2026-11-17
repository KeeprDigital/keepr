import type { ServerTimeReading } from '../../shared/utils/serverTime';

/**
 * The reading `useServerTime` corrects a device's clock against. An app serves
 * it at `SERVER_TIME_PATH`: `export default defineEventHandler(readServerTime)`.
 */
export function readServerTime(): ServerTimeReading {
	return { serverTime: Date.now() };
}
