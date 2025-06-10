import type { Env } from './types'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { prettyJSON } from 'hono/pretty-json'
import { cardsRoute } from './routes/cards'

const app = new Hono<{ Bindings: Env }>()

app.use('*', logger())
app.use('*', prettyJSON())
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET, OPTIONS'],
  allowHeaders: ['Content-Type'],
  maxAge: 86400,
}))

// Add cache headers to all successful API responses
app.use('/*', async (c, next) => {
  await next()

  if (c.res.status === 200) {
    // Add Vary header for better caching
    c.header('Vary', 'Accept-Encoding')
    // Let Cloudflare cache at edge for 5 minutes, browsers for 1 minute
    c.header('Cache-Control', 'public, max-age=60, s-maxage=300')
  }
})

app.route('/', cardsRoute)

app.notFound((c) => {
  return c.json({ error: 'Route not found' }, 404)
})

app.onError((err, c) => {
  console.error('Unhandled error:', err)
  return c.json({
    error: 'Internal server error',
    details: err.message,
  }, 500)
})

export default app
