import type { CommanderSubmission } from '../../shared/types/ws'

// Broadcast function that works with Cloudflare Workers
export async function broadcastCommanderUpdate(type: 'newSubmission' | 'statsUpdated', data: any) {
  // In Cloudflare Workers with WebSockets, we can't directly broadcast from outside the WebSocket handler
  // Instead, we'll store the latest data in KV or another storage mechanism
  // For now, we'll just log that we would broadcast

  // In a production setup, you would:
  // 1. Store the update in Cloudflare KV or Durable Objects
  // 2. Have the WebSocket handler poll for updates
  // 3. Or use Cloudflare Queues to trigger broadcasts

  console.log('[broadcast] Would broadcast:', { type, data })

  // Alternative approach: Store in a temporary cache that WebSocket handler can check
  try {
    const storage = useStorage('cache')
    await storage.setItem(`ws:broadcast:${Date.now()}`, { type, data }, { ttl: 60 })
  }
  catch (error) {
    console.error('[broadcast] Failed to store broadcast message:', error)
  }
}
