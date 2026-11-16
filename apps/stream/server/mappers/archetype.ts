import type { DbArchetype } from '~~/server/db/schema';
import { mapTimestamps } from '@keepr/nuxt-layer/server/utils/mapTimestamps';

export function mapArchetypeToResponse(archetype: DbArchetype) {
	return mapTimestamps(archetype);
}
