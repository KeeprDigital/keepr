import { answerAsActor } from '~~/server/utils/actorRoute';
import { readAuditRecord } from '~~/server/utils/keeprAdministration';

/** The latest rows of the Audit Record, newest first, for a Keepr Administrator. */
export default defineEventHandler(
	async (event) =>
		await answerAsActor(event, async (database, actor) => await readAuditRecord(database, actor)),
);
