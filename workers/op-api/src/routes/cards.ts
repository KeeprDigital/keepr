import type { OpCardData } from '@keepr/types'
import type { Env } from '../types'
import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { cache } from 'hono/cache'
import { QueryParamsSchema } from '../types'

export const cardsRoute = new Hono<{ Bindings: Env }>()

const VALID_QUERY_COLUMNS: (keyof OpCardData)[] = [
  'name',
  'rarity',
  'category',
  'cost',
  'power',
  'counter',
  'pack_id',
]

const PARTIAL_MATCH_COLUMNS: (keyof OpCardData)[] = ['name', 'effect']
const NUMERIC_COLUMNS: (keyof OpCardData)[] = ['cost', 'power', 'counter']
const JSON_COLUMNS: (keyof OpCardData)[] = ['colors', 'types', 'attributes']

cardsRoute.get(
  '/cards',
  cache({
    cacheName: 'cards-api',
    cacheControl: 'max-age=300', // 5 minutes
  }),
  zValidator('query', QueryParamsSchema),
  async (c) => {
    try {
      const params = c.req.valid('query')
      const { limit = 100, offset = 0, ...queryParams } = params

      const conditions: string[] = []
      const values: (string | number)[] = []

      // Build WHERE conditions
      for (const [key, value] of Object.entries(queryParams)) {
        if (value !== undefined && value !== null && value !== ''
          && VALID_QUERY_COLUMNS.includes(key as keyof OpCardData)) {
          const columnName = key

          if (NUMERIC_COLUMNS.includes(columnName as keyof OpCardData)) {
            conditions.push(`${columnName} = ?`)
            values.push(value as number)
          }
          else if (JSON_COLUMNS.includes(columnName as keyof OpCardData)) {
            conditions.push(`json_extract(${columnName}, '$') LIKE ?`)
            values.push(`%"${value}"%`)
          }
          else if (PARTIAL_MATCH_COLUMNS.includes(columnName as keyof OpCardData)) {
            conditions.push(`${columnName} LIKE ?`)
            values.push(`%${value}%`)
          }
          else {
            conditions.push(`${columnName} = ?`)
            values.push(value as string)
          }
        }
      }

      // Build and execute SQL query
      let sql = 'SELECT * FROM cards'
      if (conditions.length > 0) {
        sql += ` WHERE ${conditions.join(' AND ')}`
      }
      sql += ` ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`

      const stmt = c.env.DB.prepare(sql)
      const result = values.length > 0
        ? await stmt.bind(...values).all<OpCardData>()
        : await stmt.all<OpCardData>()

      if (!result.success) {
        throw new Error('Database query failed')
      }

      // Transform data
      const cards = result.results.map(card => ({
        ...card,
        colors: card.colors ? JSON.parse(card.colors) : null,
        types: card.types ? JSON.parse(card.types) : null,
        attributes: card.attributes ? JSON.parse(card.attributes) : null,
      }))

      // Get total count for pagination
      let total = 0
      if (offset === 0) {
        let countSql = 'SELECT COUNT(*) as count FROM cards'
        if (conditions.length > 0) {
          countSql += ` WHERE ${conditions.join(' AND ')}`
        }

        const countStmt = c.env.DB.prepare(countSql)
        const countResult = values.length > 0
          ? await countStmt.bind(...values).first<{ count: number }>()
          : await countStmt.first<{ count: number }>()

        total = countResult?.count || 0
      }

      return c.json({
        data: cards,
        pagination: {
          limit,
          offset,
          total: offset === 0 ? total : undefined,
          hasMore: cards.length === limit,
        },
      })
    }
    catch (error) {
      console.error('Error in cards handler:', error)
      return c.json(
        {
          error: 'Failed to retrieve cards from the database',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      )
    }
  },
)

// Single card endpoint with longer cache
cardsRoute.get(
  '/cards/:id',
  cache({
    cacheName: 'single-card',
    cacheControl: 'max-age=1800', // 30 minutes
  }),
  async (c) => {
    try {
      const id = c.req.param('id')

      const stmt = c.env.DB.prepare('SELECT * FROM cards WHERE id = ?')
      const result = await stmt.bind(id).first<OpCardData>()

      if (!result) {
        return c.json({ error: 'Card not found' }, 404)
      }

      const card = {
        ...result,
        colors: result.colors ? JSON.parse(result.colors) : null,
        types: result.types ? JSON.parse(result.types) : null,
        attributes: result.attributes ? JSON.parse(result.attributes) : null,
      }

      return c.json(card)
    }
    catch (error) {
      console.error('Error fetching card:', error)
      return c.json(
        {
          error: 'Failed to retrieve card',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500,
      )
    }
  },
)
