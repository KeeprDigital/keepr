/**
 * Stream Keepr's answer to realtime's port (ADR-0137): who a socket's caller
 * is, and what it may hear. Only the realtime layer's hand-off reaches this
 * route; any other request is answered 404 (`defineRealtimePort`).
 *
 * Nobody is let in yet. A Session's socket and a Screen Output's ticket are
 * #1315, and until then every socket is refused with a close a page can read.
 */
export default defineRealtimePort(() => null);
