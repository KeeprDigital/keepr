/**
 * The object's default timings and its fixed limits. Apart from the class, so
 * what reads them needs no Workers runtime.
 */

export const DEFAULT_RETENTION_MS: number = 2 * 60 * 1000;
export const DEFAULT_GRACE_MS: number = 5000;
/** Three missed pings of a client that sends one every 15 s. */
export const DEFAULT_SWEEP_MS: number = 45_000;
/**
 * Longer than a hand-off takes, from the app's port deciding a grant to the
 * object accepting its socket: a grant decided before a disconnect reaches the
 * object within this of it, or not at all.
 */
export const DEFAULT_WITHDRAWAL_MS: number = 60_000;
/** An hour: a socket's caller is judged again at least this often. */
export const DEFAULT_MAX_AGE_MS: number = 60 * 60 * 1000;
/** Far more than one person opens pages of one scope at once. */
export const DEFAULT_SOCKETS_PER_IDENTITY = 32;
/** How long a ticket waits for its socket: the upgrade follows it in the same call. */
export const TICKET_MS = 10_000;
/** A message stays within 64 KiB (ADR-0137): its data, as JSON, in UTF-8. */
export const MAX_MESSAGE_BYTES: number = 64 * 1024;
/**
 * What one socket may send: a burst of this many frames, refilled at
 * `FRAMES_PER_SECOND`. A page asks for an attach, a watch or an entry for each
 * thing it mounts, so the burst covers a page's first paint. A ping is the
 * runtime's to answer, and is not counted.
 */
export const FRAME_BURST = 120;
export const FRAMES_PER_SECOND = 20;
/**
 * The longest frame the object reads, in characters: twice what a socket's
 * attachment holds, so a frame it could never keep is not parsed. One longer
 * closes the socket with `CLOSE_TOO_LARGE`.
 */
export const MAX_CLIENT_FRAME_LENGTH: number = 32 * 1024;
/**
 * The most a `hello` may name, attaches, watches and entries together, before
 * any is read. One that names more closes the socket with `CLOSE_TOO_LARGE`.
 */
export const MAX_HELLO_ENTRIES = 256;
