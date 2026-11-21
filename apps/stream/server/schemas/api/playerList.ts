import { createInsertSchema, createUpdateSchema } from 'drizzle-zod';
import { z } from 'zod';
import { playerLists } from '~~/server/db/schema';
import { eventIdParamSchema } from '~~/server/schemas/api/eventId';

// ── Player List CRUD Schemas ──

export const createPlayerListSchema = createInsertSchema(playerLists)
	.omit({
		id: true,
		eventId: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		name: z.string().min(1).max(200),
	})
	.strict();

export const updatePlayerListSchema = createUpdateSchema(playerLists)
	.omit({
		id: true,
		eventId: true,
		createdAt: true,
		updatedAt: true,
	})
	.extend({
		name: z.string().min(1).max(200).optional(),
	})
	.strict();

// ── Member Management Schemas ──

/**
 * The most Players a reorder names. A reorder names every member, and a list
 * grows past the 500 one add takes, so it is bounded by an Event's field.
 */
export const PLAYER_LIST_REORDER_MAX_MEMBERS = 5000;

function playerIdListSchema(max: number) {
	return z
		.array(z.number().int().positive())
		.min(1)
		.max(max)
		.refine((playerIds) => new Set(playerIds).size === playerIds.length, {
			message: 'playerIds must not contain duplicates',
		});
}

export const addMembersSchema = z
	.object({
		playerIds: playerIdListSchema(500),
	})
	.strict();

export const batchRemoveMembersSchema = z
	.object({
		playerIds: playerIdListSchema(500),
	})
	.strict();

export const reorderMembersSchema = z
	.object({
		playerIds: playerIdListSchema(PLAYER_LIST_REORDER_MAX_MEMBERS),
	})
	.strict();

// ── Route Params ──

export const playerListParamsSchema = z.object({
	id: eventIdParamSchema, // eventId
	listId: z.coerce.number().int().positive(),
});

export const playerListMemberParamsSchema = z.object({
	id: eventIdParamSchema, // eventId
	listId: z.coerce.number().int().positive(),
	playerId: z.coerce.number().int().positive(),
});

// ── Types ──

export type CreatePlayerListInput = z.infer<typeof createPlayerListSchema>;
export type UpdatePlayerListInput = z.infer<typeof updatePlayerListSchema>;
export type AddMembersInput = z.infer<typeof addMembersSchema>;
export type BatchRemoveMembersInput = z.infer<typeof batchRemoveMembersSchema>;
export type ReorderMembersInput = z.infer<typeof reorderMembersSchema>;
export type PlayerListParams = z.infer<typeof playerListParamsSchema>;
export type PlayerListMemberParams = z.infer<typeof playerListMemberParamsSchema>;
