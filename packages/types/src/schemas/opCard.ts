import { z } from 'zod/v4'

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
