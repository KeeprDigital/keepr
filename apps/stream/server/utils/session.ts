import type { H3Event } from 'h3';
import type { AppRole } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import type { Identity } from '@keepr/nuxt-layer/shared/utils/identityProof';
import { readConfiguredSecret } from '@keepr/nuxt-layer/server/utils/configuredSecret';
import {
	ServiceConfigurationError,
	TemporarilyUnavailableError,
} from '@keepr/nuxt-layer/server/utils/errors';
import {
	createIdentityResolver,
	requireAppAccess,
	resolveRequestIdentity,
} from '@keepr/nuxt-layer/server/utils/requestIdentity';
import { discardRetiredSignInCookie } from './retiredSignInCookie';
import { writeTimingOf } from './writeTiming';

/**
 * Who a request belongs to, as Stream Keepr reads it: from an Identity Proof
 * Keepr Accounts signs and this Worker verifies, and from nothing else
 * (ADR-0113, ADR-0141). No setting, variable, header or query admits a request
 * without one. Locally the Accounts Stand-in answers the same binding.
 *
 * One Installation serves one Organisation (ADR-0161): an Identity Proof that
 * names any other is refused as one with no App access.
 */

/** The App this Worker is, as the App registry names it. */
const APP = 'stream';

/** A signed-in User with App access to Stream Keepr, and the Session they are in. */
export type StreamIdentity = Identity<typeof APP> & { appRole: AppRole<typeof APP> };

/** Where a request keeps the answer it has already been given, for as long as the request lives. */
const REQUEST_IDENTITY_CONTEXT_KEY = 'streamIdentity';

/**
 * The isolate's resolver, which holds the Identity Proofs it has verified and
 * shares them with the Worker's other isolates through its Cache API
 * (ADR-0150). Its own, not the layer's default, so a write's log line can say
 * how each was had.
 */
const resolveIdentity = createIdentityResolver(APP);

/** The status the layer refuses a signed-out visitor with. */
const SIGNED_OUT_STATUS = 401;

/**
 * Who this request belongs to, or `null` for a signed-out visitor, asked once
 * however many times a request asks.
 *
 * A User with no App access to Stream Keepr is refused here, by the layer's
 * `requireAppAccess`, so no caller can hold an Identity that has none: the
 * refusal is the same on every route, and the same in every App. With no
 * Identity Proof to trust and no answer from Keepr Accounts it raises the
 * layer's 503, and logs why.
 *
 * The promise is kept, not the answer, so two questions asked at once share
 * one. Any Session cookie Keepr Accounts renewed is passed on to the browser by
 * the layer, once.
 */
export async function requestIdentity(event: H3Event): Promise<StreamIdentity | null> {
	const asked = event.context[REQUEST_IDENTITY_CONTEXT_KEY] as
		| Promise<StreamIdentity | null>
		| undefined;
	if (asked) return await asked;

	const timing = writeTimingOf(event);
	const asking = timing ? timing.time('identity', () => readIdentity(event)) : readIdentity(event);
	event.context[REQUEST_IDENTITY_CONTEXT_KEY] = asking;
	return await asking;
}

/** The setting that names the Installation's Organisation, as an operator sets it. */
const INSTALLATION_ORGANISATION_SETTING = 'NUXT_INSTALLATION_ORGANISATION_ID';

/**
 * The Organisation whose data this Installation holds (ADR-0161). Unset, no
 * Organisation's User is admitted: a 503 that names the setting, never every
 * Organisation.
 */
function installationOrganisationId(event: H3Event): string {
	const id = readConfiguredSecret(
		useRuntimeConfig(event).installationOrganisationId,
		INSTALLATION_ORGANISATION_SETTING,
	);
	if (!id)
		throw new ServiceConfigurationError(
			INSTALLATION_ORGANISATION_SETTING,
			"is not set, so no Organisation's User can be admitted",
		);
	return id;
}

async function readIdentity(event: H3Event): Promise<StreamIdentity | null> {
	const organisationId = installationOrganisationId(event);
	// Before Keepr Accounts is asked: it reads the first session cookie it is sent.
	discardRetiredSignInCookie(event);
	let identity: Identity<typeof APP>;
	try {
		identity = await resolveRequestIdentity(event, APP, async (question) => {
			const answer = await resolveIdentity(question);
			if (answer.kind === 'signed-in') writeTimingOf(event)?.identityProof(answer.proof);
			return answer;
		});
	} catch (refusal) {
		if ((refusal as { statusCode?: unknown }).statusCode === SIGNED_OUT_STATUS) return null;
		throw refusal;
	}
	// A User working in another Organisation, or in none, has no App access to
	// this Installation, whatever App role that Organisation gave them (ADR-0161).
	const admitted =
		identity.organisation?.id === organisationId ? identity : { ...identity, appRole: null };
	requireAppAccess(admitted);
	return admitted;
}

/**
 * Who this request belongs to, or `null`, for a route another credential may
 * admit: a Screen Output presents a Screen Output Asset Capability and has no
 * Session at all.
 *
 * It answers `null` where `requestIdentity` would refuse: for a User with no
 * App access, and while Keepr Accounts cannot be asked. So it never admits
 * anyone, and never takes an output down with Keepr Accounts. **Only a route
 * with a credential-free arm may call it**, and that route refuses in its own
 * words when both arms fail; a route a Session is the only way into asks
 * `requestIdentity`, or is behind the Session boundary, which does.
 */
export async function optionalIdentity(event: H3Event): Promise<StreamIdentity | null> {
	try {
		return await requestIdentity(event);
	} catch (refusal) {
		if (
			refusal instanceof ServiceConfigurationError ||
			refusal instanceof TemporarilyUnavailableError ||
			(refusal as { statusCode?: unknown }).statusCode === 403
		)
			return null;
		throw refusal;
	}
}

/**
 * The Session, or the boundary's own refusal.
 *
 * The 401 is written here as literals matching `server/middleware/api-session.ts`:
 * `test/helpers/routeRefusalScan.ts` reads a `const` only within the file it is
 * reading. Every caller is behind the boundary, which has already refused a
 * signed-out visitor; this fails closed the day one is not.
 */
async function requireIdentity(event: H3Event): Promise<StreamIdentity> {
	const identity = await requestIdentity(event);
	if (identity) return identity;

	throw createError({
		statusCode: 401,
		statusMessage: 'Unauthorized',
		message: 'Authentication is required',
	});
}

/**
 * The User this request is acting as: who a Graphics Ingestion Operation
 * records as its initiator, and who an author-scoped route matches on. The
 * User, not the browser, so an operation outlives the Session it started in.
 *
 * Some routes call this for the refusal alone, so each route's own graph
 * refuses before it touches the library.
 */
export async function requireUserId(event: H3Event): Promise<string> {
	return (await requireIdentity(event)).user.id;
}

/**
 * The Session this request is in, where it must have one: the holder of a
 * Graphics Authoring Lease is a Session, because one User in two browsers is
 * two editors.
 */
export async function requireBrowserSessionId(event: H3Event): Promise<string> {
	return (await requireIdentity(event)).sessionId;
}

/**
 * Who takes a Graphics Authoring Lease: the Session that holds it, and what to
 * call its User where another Session finds the artifact held. The name is the
 * Identity Proof's, kept with the lease because Stream Keepr holds no User to
 * read it from later.
 */
export async function requireLeaseHolder(
	event: H3Event,
): Promise<{ sessionId: string; holderName: string }> {
	const identity = await requireIdentity(event);
	return { sessionId: identity.sessionId, holderName: identity.user.name };
}

/**
 * The Session this request is in, where there is one: a lease admission tells
 * "no Session" from "another Session's lease".
 */
export async function optionalBrowserSessionId(event: H3Event): Promise<string | undefined> {
	return (await requestIdentity(event))?.sessionId;
}
