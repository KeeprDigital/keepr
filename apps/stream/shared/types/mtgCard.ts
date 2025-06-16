import type { MtgCardDisplayDataSchema } from '@keepr/types'
import type { z } from 'zod/v4'
import { MtgCardDataSchema } from '@keepr/types'
import { sharedCardTimeoutDataSchema } from '../schemas/shared'

export type MtgCardServerEvents = {
  connected: (card: TopicData<'mtgCard'> | null) => void
  sync: (card: TopicData<'mtgCard'> | null) => void
}

export type MtgCardClientEvents = {
  set: (card: TopicData<'mtgCard'>) => void
  control: (action: MtgPreviewCardAction) => void
  clear: () => void
}

export type MtgActiveCardAction
  = | 'clear'

export type MtgPreviewCardAction
  = | 'show'
    | 'clear'
    | 'rotate'
    | 'counterRotate'
    | 'flip'
    | 'turnOver'

const _mtgCardSchema = MtgCardDataSchema.extend({
  timeoutData: sharedCardTimeoutDataSchema.optional(),
})

export type MtgCard = z.infer<typeof _mtgCardSchema>
export type MtgCardDisplay = z.infer<typeof MtgCardDisplayDataSchema>
