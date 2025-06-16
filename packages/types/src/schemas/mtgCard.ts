import type { ScryfallCardFields, ScryfallImageUris } from '@scryfall/api-types'
import { z } from 'zod/v4'

export const MtgCardDisplayDataSchema = z.object({
  flipped: z.boolean(),
  rotated: z.boolean(),
  counterRotated: z.boolean(),
  turnedOver: z.boolean(),
})

export const MtgCardImageDataSchema = z.object({
  front: z.custom<ScryfallImageUris>().nullable(),
  back: z.custom<ScryfallImageUris>().nullable(),
})

export const MtgCardOrientationDataSchema = z.object({
  flipable: z.boolean(),
  turnable: z.boolean(),
  rotateable: z.boolean(),
  counterRotateable: z.boolean(),
})

export const MtgCardMeldDataSchema = z.object({
  meldPartOne: z.string().nullable(),
  meldPartTwo: z.string().nullable(),
  meldResult: z.string().nullable(),
})

export const MtgCardDataSchema = z.object({
  id: z.string(),
  name: z.string(),
  set: z.string(),
  layout: z.custom<ScryfallCardFields.Core.All['layout']>(),
  points: z.number(),
  imageData: MtgCardImageDataSchema,
  orientationData: MtgCardOrientationDataSchema,
  displayData: MtgCardDisplayDataSchema,
  meldData: MtgCardMeldDataSchema.optional(),
})

export type MtgCardData = z.infer<typeof MtgCardDataSchema>
