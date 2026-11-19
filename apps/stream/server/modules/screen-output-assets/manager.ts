import { createScreenOutputAssetCapability, screenOutputAssetCapabilityDigest } from './capability';
import { createScreenOutputLink, parseScreenOutputLink, screenOutputLinkIsFor } from './link';

export interface PersistedScreenOutputAssetCapability {
	assetCapabilitySeed: string;
	assetCapabilityVersion: number;
	assetCapabilityDigest: string;
}

interface CapabilityScreen extends PersistedScreenOutputAssetCapability {
	id: number;
	eventId: number;
}

interface ScreenOutputAssetCapabilityManagerDependencies {
	signingKey: string;
	screens: {
		findById: (screenId: number, eventId: number) => Promise<CapabilityScreen | undefined>;
		/** A Screen Output Link names its Screen and nothing else, so its Event is read, not presented. */
		findByIdInAnyEvent: (screenId: number) => Promise<CapabilityScreen | undefined>;
		replaceAssetCapability: (
			screenId: number,
			eventId: number,
			replacement: PersistedScreenOutputAssetCapability,
			expectedVersion: number,
		) => Promise<CapabilityScreen | undefined>;
	};
	/**
	 * Close the realtime sockets the Screen's outputs hold, but for the ones the
	 * capability of `capabilityVersion` let in (ADR-0137, ADR-0142). `rotate`
	 * calls it once the regenerated capability is stored, and never before,
	 * with that capability's version.
	 */
	disconnectOutputs: (screen: FormerOutputs) => Promise<unknown>;
	generateSeed?: () => string;
}

/** A Screen whose outputs are to be closed, and the version of the capability that replaced theirs. */
interface FormerOutputs {
	eventId: number;
	screenId: number;
	capabilityVersion: number;
}

/** How often `rotate` asks for the Screen's sockets to be closed before it gives up. */
const DISCONNECT_ATTEMPTS = 2;

type ScreenOutputAssetCapabilityOutcome =
	| { outcome: 'available'; capability: string; link: string }
	| { outcome: 'missing' };

type ScreenOutputLinkExchangeOutcome =
	| { outcome: 'available'; eventId: number; screenId: number; capability: string }
	| { outcome: 'missing' };

export function createScreenOutputAssetCapabilityManager(
	dependencies: ScreenOutputAssetCapabilityManagerDependencies,
) {
	const generateSeed = dependencies.generateSeed ?? (() => crypto.randomUUID());

	async function derive(
		persisted: Pick<
			PersistedScreenOutputAssetCapability,
			'assetCapabilitySeed' | 'assetCapabilityVersion'
		>,
	) {
		return await createScreenOutputAssetCapability({
			signingKey: dependencies.signingKey,
			seed: persisted.assetCapabilitySeed,
			version: persisted.assetCapabilityVersion,
		});
	}

	async function deriveLink(
		screenId: number,
		persisted: Pick<
			PersistedScreenOutputAssetCapability,
			'assetCapabilitySeed' | 'assetCapabilityVersion'
		>,
	) {
		return await createScreenOutputLink({
			signingKey: dependencies.signingKey,
			screenId,
			seed: persisted.assetCapabilitySeed,
			version: persisted.assetCapabilityVersion,
		});
	}

	async function prepare(
		input: {
			seed?: string;
			version?: number;
		} = {},
	) {
		const seed = input.seed ?? generateSeed();
		const version = input.version ?? 1;
		const capability = await derive({
			assetCapabilitySeed: seed,
			assetCapabilityVersion: version,
		});
		return {
			capability,
			persisted: {
				assetCapabilitySeed: seed,
				assetCapabilityVersion: version,
				assetCapabilityDigest: await screenOutputAssetCapabilityDigest(capability),
			},
		};
	}

	async function current(input: {
		eventId: number;
		screenId: number;
	}): Promise<ScreenOutputAssetCapabilityOutcome> {
		const screen = await dependencies.screens.findById(input.screenId, input.eventId);
		if (!screen) return { outcome: 'missing' };
		return {
			outcome: 'available',
			capability: await derive(screen),
			link: await deriveLink(screen.id, screen),
		};
	}

	/**
	 * Close the sockets the former capability admitted. The capability is
	 * already regenerated, and nothing here can undo that, so a failure is not
	 * the regeneration's: it is tried again, and then written where an operator
	 * reads it, because those sockets go on hearing their Screen's channel until
	 * they drop. They cannot return: the former capability is given no ticket.
	 */
	async function disconnectOutputs(screen: FormerOutputs) {
		let failure: unknown;
		for (let attempt = 0; attempt < DISCONNECT_ATTEMPTS; attempt++) {
			try {
				await dependencies.disconnectOutputs(screen);
				return;
			} catch (error) {
				failure = error;
			}
		}
		console.error(
			JSON.stringify({
				message: 'screen_output_disconnect_failed',
				detail:
					"The Screen Output Asset Capability was regenerated, but the Screen's realtime sockets could not be closed. Outputs opened under the former capability may still hear the Screen's channel until they disconnect. Regenerate the capability again to close them.",
				eventId: screen.eventId,
				screenId: screen.screenId,
				errorName: failure instanceof Error ? failure.name : null,
				errorMessage: failure instanceof Error ? failure.message : String(failure),
			}),
		);
	}

	/**
	 * Regenerate the Screen's capability. Once the write has committed, the
	 * realtime sockets its outputs hold are closed (ADR-0137): the former
	 * capability reads nothing from then on, is given no Realtime Ticket, and
	 * the tickets it was given admit nobody (`server/modules/realtime-ticket`).
	 */
	async function rotate(input: {
		eventId: number;
		screenId: number;
	}): Promise<ScreenOutputAssetCapabilityOutcome> {
		const screen = await dependencies.screens.findById(input.screenId, input.eventId);
		if (!screen) return { outcome: 'missing' };
		const prepared = await prepare({
			seed: generateSeed(),
			version: screen.assetCapabilityVersion + 1,
		});
		const updated = await dependencies.screens.replaceAssetCapability(
			input.screenId,
			input.eventId,
			prepared.persisted,
			screen.assetCapabilityVersion,
		);
		if (!updated) return { outcome: 'missing' };
		await disconnectOutputs({
			eventId: updated.eventId,
			screenId: updated.id,
			capabilityVersion: prepared.persisted.assetCapabilityVersion,
		});
		return {
			outcome: 'available',
			capability: prepared.capability,
			link: await deriveLink(updated.id, prepared.persisted),
		};
	}

	/**
	 * Exchange a Screen Output Link for its Screen's current capability.
	 *
	 * One `missing` for a value that is not a link, a link whose MAC is wrong or
	 * from before a rotation, and a Screen that does not exist; the last two take
	 * the same signing work (`screenOutputLinkIsFor`).
	 */
	async function exchange(input: { link: unknown }): Promise<ScreenOutputLinkExchangeOutcome> {
		const link = input.link;
		const named = parseScreenOutputLink(link);
		if (!named || typeof link !== 'string') return { outcome: 'missing' };
		const screen = await dependencies.screens.findByIdInAnyEvent(named.screenId);
		const verified = await screenOutputLinkIsFor({
			signingKey: dependencies.signingKey,
			link,
			screenId: named.screenId,
			identity: screen && {
				seed: screen.assetCapabilitySeed,
				version: screen.assetCapabilityVersion,
			},
		});
		if (!screen || !verified) return { outcome: 'missing' };
		return {
			outcome: 'available',
			eventId: screen.eventId,
			screenId: screen.id,
			capability: await derive(screen),
		};
	}

	return {
		prepare,
		current,
		rotate,
		exchange,
	};
}

export type ScreenOutputAssetCapabilityManager = ReturnType<
	typeof createScreenOutputAssetCapabilityManager
>;
