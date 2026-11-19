import type { H3Event } from 'h3';
import type { DbScreen } from '~~/server/db/schema';
import { screenOutputAssetCapabilityDigest } from '~~/server/modules/screen-output-assets/capability';
import { bearerScreenOutputCapability } from '~~/server/utils/screenOutputCapabilityAuthorization';
import { optionalIdentity } from '~~/server/utils/session';
import { secretTokensMatch } from '@keepr/nuxt-layer/server/utils/secretTokenComparison';

/** Which credential admitted a Screen Output read. */
export type ScreenOutputReader = 'capability' | 'session';

/**
 * Who this request reads one Screen's published data as, or `null` if it may not.
 *
 * An unattended Screen Output presents the capability stored against that Screen;
 * an operator embed presents its Session. Capability succeeds without asking
 * Keepr Accounts anything, because outputs deliberately have no Session of their
 * own, so an output keeps reading while Keepr Accounts cannot be reached. Callers
 * retain their own one-sentence 404 so every resource on the capability surface
 * stays non-enumerating: a User with no App access, and a Session nobody can
 * vouch for just now, read as no Session (`optionalIdentity`).
 *
 * Which arm admitted matters only to a read whose client names the resource: a
 * capability reaches only what the Screen's saved configuration publishes, while a
 * session — which can read the whole Event privately anyway — also reaches what an
 * editor preview has not saved yet.
 */
export async function screenOutputReader(
	event: H3Event,
	screen: Pick<DbScreen, 'assetCapabilityDigest'>,
): Promise<ScreenOutputReader | null> {
	const capability = bearerScreenOutputCapability(getRequestHeader(event, 'authorization'));
	if (capability) {
		const presentedDigest = await screenOutputAssetCapabilityDigest(capability);
		if (await secretTokensMatch(presentedDigest, screen.assetCapabilityDigest)) return 'capability';
	}

	return (await optionalIdentity(event)) ? 'session' : null;
}

/** Whether this request may read data published exclusively by one Screen. */
export async function canReadScreenOutput(
	event: H3Event,
	screen: Pick<DbScreen, 'assetCapabilityDigest'>,
): Promise<boolean> {
	return (await screenOutputReader(event, screen)) !== null;
}
