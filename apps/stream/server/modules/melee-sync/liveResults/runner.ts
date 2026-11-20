import { eventService } from '~~/server/services/event';
import { errorNameOf } from '@keepr/nuxt-layer/server/utils/errorLogFields';
import { runLiveResultsTick } from './tick';

/**
 * Events ticked per cron run. Each tick is a few Melee requests and D1
 * statements, run one after another, so a run stays well inside the Worker's
 * subrequest and wall-time limits and Melee sees one Event at a time.
 */
export const LIVE_RESULTS_MAX_EVENTS_PER_RUN = 25;

/**
 * How long a run may keep starting ticks. Well inside the minute between cron
 * runs, so a run is done before the next one reads the due Events: an Event a
 * run did not reach is due for the next.
 */
export const LIVE_RESULTS_RUN_BUDGET_MS = 30_000;

/**
 * Runs the Live Results tick of every Event due when the run starts,
 * longest-waiting first, one at a time. Each tick reads `clock` when it starts,
 * so its lease and poll state carry its own time, and no tick starts once the
 * run's budget is spent. One Event's failure is logged and never stops the rest.
 */
export async function runDueLiveResultsTicks(clock: () => Date = () => new Date()): Promise<void> {
	const startedAt = clock();
	const dueEventIds = await eventService().findDueMeleeLiveResults(
		startedAt,
		LIVE_RESULTS_MAX_EVENTS_PER_RUN,
	);
	for (const [index, eventId] of dueEventIds.entries()) {
		const now = clock();
		if (now.getTime() - startedAt.getTime() >= LIVE_RESULTS_RUN_BUDGET_MS) {
			console.warn(
				JSON.stringify({
					message: 'melee_live_results_run_budget_spent',
					deferredEvents: dueEventIds.length - index,
				}),
			);
			return;
		}
		try {
			await runLiveResultsTick(eventId, now);
		} catch (error) {
			console.error(
				JSON.stringify({
					message: 'melee_live_results_tick_failed',
					eventId,
					errorName: errorNameOf(error),
				}),
			);
		}
	}
}
