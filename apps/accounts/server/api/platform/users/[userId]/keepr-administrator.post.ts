import { getRouterParam } from 'h3';
import { answerAsActor } from '~~/server/utils/actorRoute';
import { grantKeeprAdministrator } from '~~/server/utils/keeprAdministration';

/** Makes another User a Keepr Administrator (ADR-0156). */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(event, async (database, actor) => {
			await grantKeeprAdministrator(database, actor, getRouterParam(event, 'userId') ?? '');
			return { keeprAdministrator: true };
		}),
);
