import type { DbRound } from '~~/server/db/schema';
import type { RoundResponse } from '~~/shared/api';
import { mapTimestamps } from '@keepr/nuxt-layer/server/utils/mapTimestamps';

export function mapRoundToResponse(round: DbRound): RoundResponse {
	return mapTimestamps(round);
}
