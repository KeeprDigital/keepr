import type { DbMatch } from '~~/server/db/schema';
import type { MatchResponse } from '~~/shared/api';
import { mapTimestamps } from '@keepr/nuxt-layer/server/utils/mapTimestamps';

export function mapMatchToResponse(match: DbMatch): MatchResponse {
	return mapTimestamps(match);
}
