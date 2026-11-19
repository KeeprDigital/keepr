/**
 * How the built Worker's port knows a request is the hand-off's own. The entry
 * marks the request object it makes, and the port's route asks whether the
 * request it was handed is one of those: a request from outside is another
 * object, whatever it carries, so no caller can ask the port.
 */
const handOffs = new WeakSet<Request>();

/** The entry's, before it puts `asked` to the app. */
export function markHandOff(asked: Request): Request {
	handOffs.add(asked);
	return asked;
}

/** The port's: whether `request` is one the entry made. */
export function isMarkedHandOff(request: unknown): boolean {
	return typeof request === 'object' && request !== null && handOffs.has(request as Request);
}
