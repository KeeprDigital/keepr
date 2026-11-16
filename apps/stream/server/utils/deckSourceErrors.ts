export class ScreenDeckSourceConflictError extends Error {
	statusCode = 409;
	code = 'SCREEN_DECK_SOURCE_CONFLICT';
	constructor() {
		super('The selected Deck source is no longer available');
		this.name = 'ScreenDeckSourceConflictError';
	}
}

/**
 * Rethrows the `screens` Deck-source triggers' refusal as its stable conflict.
 *
 * Every write that can change a Deck configuration needs it, whichever path
 * carries the write: a Deck List Screen's own Background Layers send its mode
 * writes through the Graphic Asset Reference write too (#580).
 */
export function mapDeckSourceConflict(error: unknown): never {
	let failure: unknown = error;
	while (failure && typeof failure === 'object') {
		if (String((failure as { message?: unknown }).message).includes('SCREEN_DECK_SOURCE_CONFLICT'))
			throw new ScreenDeckSourceConflictError();
		failure = (failure as { cause?: unknown }).cause;
	}
	throw error;
}

export class BroadcastDeckListsInUseError extends Error {
	constructor(readonly screens: Array<{ id: number; name: string }>) {
		super('Broadcast Deck Lists are selected by one or more Screens');
		this.name = 'BroadcastDeckListsInUseError';
	}
}
