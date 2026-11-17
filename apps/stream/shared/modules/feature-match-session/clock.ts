export {
	applyClockAdjustment,
	clockTransitions,
	getEffectiveElapsedMs,
	readStoredClock,
	writeStoredClock,
} from '~~/shared/utils/clock';
export {
	formatClockTime,
	minutesToMs,
	normalizeTimeInput,
	parseTimeInput,
} from '@keepr/nuxt-layer/shared/utils/clockTime';

export type { ClockAdjustmentInput, FeatureMatchClock } from '~~/shared/utils/clock';
