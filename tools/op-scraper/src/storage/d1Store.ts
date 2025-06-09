import type { Card, Pack } from '../types'

export type D1Database = {
  prepare: (query: string) => D1PreparedStatement
  batch: (statements: D1PreparedStatement[]) => Promise<D1Result[]>
  exec: (query: string) => Promise<D1ExecResult>
}

export type D1PreparedStatement = {
  bind: (...values: any[]) => D1PreparedStatement
  first: <T = any>() => Promise<T | null>
  run: () => Promise<D1Result>
  all: <T = any>() => Promise<D1Result<T>>
}

export type D1Result<T = any> = {
  success: boolean
  meta: {
    duration: number
    changes: number
    last_row_id: number
    rows_read: number
    rows_written: number
  }
  results: T[]
  error?: string
}

export type D1ExecResult = {
  count: number
  duration: number
}

export type UploadProgress = {
  total: number
  current: number
  failed: number
  percentage: number
}

export type UploadResult = {
  success: boolean
  totalAttempted: number
  successfulUploads: number
  failedUploads: number
  failedItems: Array<{ item: Card | Pack, error: string }>
  duration: number
}

export class D1Store {
  constructor(
    private db: D1Database,
    private onProgress?: (progress: UploadProgress) => void,
  ) { }

  async insertOrUpdatePack(pack: Pack): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO packs (id, raw_title, title_parts, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    `)

    await stmt.bind(
      pack.id,
      pack.rawTitle,
      JSON.stringify(pack.titleParts),
    ).run()
  }

  async insertOrUpdateCard(card: Card): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cards (
        id, pack_id, name, rarity, category, img_url, colors, cost, 
        attributes, power, counter, types, effect, trigger, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `)

    await stmt.bind(
      card.id,
      card.packId,
      card.name,
      card.rarity,
      card.category,
      card.imgUrl,
      JSON.stringify(card.colors),
      card.cost || null,
      JSON.stringify(card.attributes),
      card.power || null,
      card.counter || null,
      JSON.stringify(card.types),
      card.effect,
      card.trigger || null,
    ).run()
  }

  async batchInsertPacks(packs: Pack[]): Promise<UploadResult> {
    if (packs.length === 0) {
      return {
        success: true,
        totalAttempted: 0,
        successfulUploads: 0,
        failedUploads: 0,
        failedItems: [],
        duration: 0,
      }
    }

    const startTime = Date.now()
    const failedItems: Array<{ item: Pack, error: string }> = []
    let successCount = 0

    const statements = packs.map((pack) => {
      return this.db.prepare(`
        INSERT OR REPLACE INTO packs (id, raw_title, title_parts, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `).bind(
        pack.id,
        pack.rawTitle,
        JSON.stringify(pack.titleParts),
      )
    })

    try {
      const results = await this.db.batch(statements)

      // Check individual results
      results.forEach((result, index) => {
        if (result.success) {
          successCount++
        }
        else {
          failedItems.push({
            item: packs[index],
            error: result.error || 'Unknown error',
          })
        }
      })
    }
    catch (error) {
      // If batch fails entirely, track all as failed
      packs.forEach((pack) => {
        failedItems.push({
          item: pack,
          error: error instanceof Error ? error.message : 'Batch operation failed',
        })
      })
    }

    const duration = Date.now() - startTime
    return {
      success: failedItems.length === 0,
      totalAttempted: packs.length,
      successfulUploads: successCount,
      failedUploads: failedItems.length,
      failedItems,
      duration,
    }
  }

  async batchInsertCards(cards: Card[], retryFailed = true): Promise<UploadResult> {
    if (cards.length === 0) {
      return {
        success: true,
        totalAttempted: 0,
        successfulUploads: 0,
        failedUploads: 0,
        failedItems: [],
        duration: 0,
      }
    }

    const startTime = Date.now()
    const failedItems: Array<{ item: Card, error: string }> = []
    let successCount = 0
    let currentProgress = 0

    const batchSize = 100 // Reduced from 1000 for better error tracking
    const totalBatches = Math.ceil(cards.length / batchSize)

    for (let i = 0; i < cards.length; i += batchSize) {
      const batch = cards.slice(i, i + batchSize)
      const batchNumber = Math.floor(i / batchSize) + 1

      // Report progress
      if (this.onProgress) {
        this.onProgress({
          total: cards.length,
          current: currentProgress,
          failed: failedItems.length,
          percentage: Math.round((currentProgress / cards.length) * 100),
        })
      }

      const statements = batch.map((card) => {
        return this.db.prepare(`
          INSERT OR REPLACE INTO cards (
            id, pack_id, name, rarity, category, img_url, colors, cost, 
            attributes, power, counter, types, effect, trigger, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).bind(
          card.id,
          card.packId,
          card.name,
          card.rarity,
          card.category,
          card.imgUrl,
          JSON.stringify(card.colors),
          card.cost || null,
          JSON.stringify(card.attributes),
          card.power || null,
          card.counter || null,
          JSON.stringify(card.types),
          card.effect,
          card.trigger || null,
        )
      })

      try {
        const results = await this.db.batch(statements)

        // Check individual results
        results.forEach((result, index) => {
          const card = batch[index]
          if (result.success) {
            successCount++
            currentProgress++
          }
          else {
            failedItems.push({
              item: card,
              error: result.error || 'Unknown error',
            })
            currentProgress++
          }
        })
      }
      catch (error) {
        // If batch fails entirely, track all cards in batch as failed
        console.error(`Batch ${batchNumber}/${totalBatches} failed:`, error)
        batch.forEach((card) => {
          failedItems.push({
            item: card,
            error: error instanceof Error ? error.message : 'Batch operation failed',
          })
          currentProgress++
        })
      }
    }

    // Final progress update
    if (this.onProgress) {
      this.onProgress({
        total: cards.length,
        current: cards.length,
        failed: failedItems.length,
        percentage: 100,
      })
    }

    // Retry failed items individually if requested
    if (retryFailed && failedItems.length > 0) {
      console.log(`Retrying ${failedItems.length} failed cards individually...`)
      const retryResults = await this.retryFailedCards(failedItems)

      // Update counts based on retry results
      successCount += retryResults.successCount
      failedItems.splice(0, failedItems.length, ...retryResults.stillFailed)
    }

    const duration = Date.now() - startTime
    return {
      success: failedItems.length === 0,
      totalAttempted: cards.length,
      successfulUploads: successCount,
      failedUploads: failedItems.length,
      failedItems,
      duration,
    }
  }

  private async retryFailedCards(
    failedItems: Array<{ item: Card, error: string }>,
  ): Promise<{ successCount: number, stillFailed: Array<{ item: Card, error: string }> }> {
    let successCount = 0
    const stillFailed: Array<{ item: Card, error: string }> = []

    for (const { item: card } of failedItems) {
      try {
        await this.insertOrUpdateCard(card)
        successCount++
      }
      catch (error) {
        stillFailed.push({
          item: card,
          error: error instanceof Error ? error.message : 'Retry failed',
        })
      }
    }

    return { successCount, stillFailed }
  }

  async getExistingCardIds(packId?: string): Promise<Set<string>> {
    const query = packId
      ? 'SELECT id FROM cards WHERE pack_id = ?'
      : 'SELECT id FROM cards'

    const stmt = packId
      ? this.db.prepare(query).bind(packId)
      : this.db.prepare(query)

    const result = await stmt.all<{ id: string }>()
    return new Set(result.results.map(row => row.id))
  }

  async getExistingPackIds(): Promise<Set<string>> {
    const stmt = this.db.prepare('SELECT id FROM packs')
    const result = await stmt.all<{ id: string }>()
    return new Set(result.results.map(row => row.id))
  }

  async getCardCount(): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM cards')
    const result = await stmt.first<{ count: number }>()
    return result?.count || 0
  }

  async getPackCount(): Promise<number> {
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM packs')
    const result = await stmt.first<{ count: number }>()
    return result?.count || 0
  }
}
