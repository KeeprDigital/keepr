import { readServerTime } from '@keepr/nuxt-layer/server/utils/serverTime';

/** Server time, which `useServerTime` syncs against (`SERVER_TIME_PATH`). */
export default defineEventHandler(readServerTime);
