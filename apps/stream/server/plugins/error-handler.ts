import process from 'node:process';
import { errorLogFields } from '@keepr/nuxt-layer/server/utils/errorLogFields';
import { safeErrorLogPath } from '~~/server/utils/errorLogPath';
import { mapPublicNitroError } from '~~/server/utils/nitroErrorMapping';
import { logWriteTiming, writeTimingOf } from '~~/server/utils/writeTiming';

interface NitroError extends Error {
	statusCode: number;
	statusMessage?: string;
	cause?: unknown;
	unhandled?: boolean;
}

export default defineNitroPlugin((nitroApp) => {
	nitroApp.hooks.hook('error', async (_error, { event }) => {
		const error = _error as NitroError;
		mapPublicNitroError(error);

		const failedStep = event ? (writeTimingOf(event)?.failedStep() ?? null) : null;
		if (!shouldSuppressIntegrationLog(error))
			console.error(
				JSON.stringify(errorLogFields(error, safeErrorLogPath(event?.path), failedStep)),
			);
		// A failure is answered by Nitro's error handler, which runs no
		// `afterResponse`: a write's timing line is logged here instead (#1376).
		// One already answered logged its own as it was.
		if (event && !event.handled) logWriteTiming(event, error.statusCode);
	});
});

function shouldSuppressIntegrationLog(error: NitroError) {
	if (process.env.STREAM_KEEPR_INTEGRATION !== 'true') return false;
	if (error.unhandled) return false;

	return error.statusCode >= 400 && error.statusCode < 500;
}
