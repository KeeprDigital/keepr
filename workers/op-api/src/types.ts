import { z } from 'zod'

export const OpCardSchema = z.object({
  id: z.string(),
  pack_id: z.string(),
  name: z.string(),
  rarity: z.string(),
  category: z.string(),
  img_url: z.string(),
  colors: z.string().nullable(),
  cost: z.number().nullable(),
  attributes: z.string().nullable(),
  power: z.number().nullable(),
  counter: z.number().nullable(),
  types: z.string().nullable(),
  effect: z.string(),
  trigger: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type OpCardData = z.infer<typeof OpCardSchema>

export const QueryParamsSchema = z.object({
  name: z.string().optional(),
  rarity: z.string().optional(),
  category: z.string().optional(),
  cost: z.string().transform(val => val ? Number.parseInt(val, 10) : undefined).optional(),
  power: z.string().transform(val => val ? Number.parseInt(val, 10) : undefined).optional(),
  counter: z.string().transform(val => val ? Number.parseInt(val, 10) : undefined).optional(),
  pack_id: z.string().optional(),
  colors: z.string().optional(),
  types: z.string().optional(),
  limit: z.string().transform(val => Math.min(Number.parseInt(val || '100', 10), 500)).optional(),
  offset: z.string().transform(val => Number.parseInt(val || '0', 10)).optional(),
})

export type QueryParams = z.infer<typeof QueryParamsSchema>

export type Env = {
  DB: D1Database
}
