import { getRequestHost, toWebRequest } from 'h3';
import { serverAuth } from '~~/server/utils/auth';
import { pendingInvitations } from '~~/server/utils/pendingInvitations';
import { answerRefusals } from '~~/server/utils/refusal';

/** The pending Invitations of the Organisation the caller works in, to an owner or admin. */
export default defineEventHandler(
	async (event) =>
		await answerRefusals(
			event,
			async () =>
				await pendingInvitations(serverAuth(getRequestHost(event)), toWebRequest(event).headers),
		),
);
