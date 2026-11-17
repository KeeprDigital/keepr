import { answerAsActor } from '~~/server/utils/actorRoute';
import { listOrganisations } from '~~/server/utils/keeprAdministration';

/** Every Organisation on the platform, for a Keepr Administrator. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(event, async (database, actor) => await listOrganisations(database, actor)),
);
