import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { enableUser } from '~~/server/utils/keeprAdministration';

/** Enables a disabled User again. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(event, async (database, actor) => {
			await enableUser(database, actor, getRouterParam(event, 'userId') ?? '');
			return { disabled: false };
		}),
);
