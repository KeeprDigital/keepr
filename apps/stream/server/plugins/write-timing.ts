import { beginWriteTiming, logWriteTiming } from '~~/server/utils/writeTiming';

/** Times each write, and logs where its time went once it is answered (`server/utils/writeTiming.ts`). */
export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('request', (event) => beginWriteTiming(event));
	nitroApp.hooks.hook('afterResponse', (event) => logWriteTiming(event));
});
