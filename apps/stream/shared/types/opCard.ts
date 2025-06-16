import type { ApiResponse, OpCardData } from '@keepr/types'
import type { z } from 'zod/v4'
import { OpCardSchema } from '@keepr/types'
import { sharedCardTimeoutDataSchema } from '../schemas/shared'

export type OpCardServerEvents = {
  connected: (card: TopicData<'opCard'> | null) => void
  sync: (card: TopicData<'opCard'> | null) => void
}

export type OpCardClientEvents = {
  set: (card: TopicData<'opCard'>) => void
  control: (action: OpActiveCardAction) => void
}

export type OpPreviewCardAction = 'show'
export type OpActiveCardAction = 'clear'

const _opCardSchema = OpCardSchema.extend({
  timeoutData: sharedCardTimeoutDataSchema.optional(),
})

export type OpCard = z.infer<typeof _opCardSchema>
export type OpCardAPIData = ApiResponse<OpCardData[]>
