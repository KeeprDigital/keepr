import realtime from './module';

/**
 * Realtime's Nuxt layer (ADR-0138): what an app that wants realtime extends,
 * beside the layer every app extends. It gives the app's Worker the entry that
 * exports the object's class and hands sockets to it, the server its publish
 * by RPC, and `nuxt dev` the Worker that holds the class.
 *
 * It registers no route and no middleware, and names no product: the app
 * states its scope, its channels and who may hear what, in a route of its own
 * (`defineRealtimePort`).
 *
 * `app/` holds nothing yet. It is there so that Nuxt takes it, and not this
 * directory, for the layer's app source: with this directory, every app that
 * extends the layer would typecheck the layer's tests as its own.
 */
export default defineNuxtConfig({
	modules: [realtime],

	compatibilityDate: '2026-07-16',
});
