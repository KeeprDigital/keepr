import { Server as Engine } from 'engine.io'
import { defineEventHandler } from 'h3'
import { Server } from 'socket.io'

let io: Server<CommanderClientEventsWithAck, CommanderServerEvents> | null = null

export function getIO() {
  if (!io) {
    throw new Error('Socket.IO not initialized')
  }
  return io
}

export default defineNitroPlugin((nitroApp) => {
  const engine = new Engine()

  nitroApp.router.use('/socket.io/', defineEventHandler({
    handler(event) {
      // @ts-expect-error incorrect type from nitro
      engine.handleRequest(event.node.req, event.node.res)
      event._handled = true
    },
    websocket: {
      open(peer) {
        // @ts-expect-error private method and property
        engine.prepare(peer._internal.nodeReq)
        // @ts-expect-error private method and property
        engine.onWebSocket(peer._internal.nodeReq, peer._internal.nodeReq.socket, peer.websocket)
      },
    },
  }))

  io = new Server<CommanderClientEventsWithAck, CommanderServerEvents>().bind(engine)

  // Set up the commander namespace
  const commanderNamespace = io.of('/commander')

  commanderNamespace.on('connection', (socket) => {
    // Handle subscription
    socket.on('subscribe', async (ack) => {
      try {
        socket.join('updates')

        ack({
          success: true,
          timestamp: Date.now(),
        })
      }
      catch (error) {
        console.error('Subscribe error:', error)
        ack({
          success: false,
          error: 'Failed to subscribe',
        })
      }
    })

    // Handle unsubscription
    socket.on('unsubscribe', async (ack) => {
      try {
        socket.leave('updates')

        ack({
          success: true,
          timestamp: Date.now(),
        })
      }
      catch (error) {
        console.error('Unsubscribe error:', error)
        ack({
          success: false,
          error: 'Failed to unsubscribe',
        })
      }
    })

    // Handle request for recent submissions
    socket.on('getRecentSubmissions', async (ack) => {
      try {
        const db = hubDatabase()

        // Get the 10 most recent submissions
        const result = await db
          .prepare(`
            SELECT
              id,
              email,
              commander_id,
              commander_name,
              commander_image,
              submitted_at
            FROM submissions
            ORDER BY submitted_at DESC
            LIMIT 10
          `)
          .all()

        ack({
          success: true,
          submissions: (result.results || []) as CommanderSubmission[],
          timestamp: Date.now(),
        } as any)
      }
      catch (error) {
        console.error('Get recent submissions error:', error)
        ack({
          success: false,
          error: 'Failed to get recent submissions',
        })
      }
    })

    socket.on('disconnect', () => {
      // Client disconnected
    })
  })
})
