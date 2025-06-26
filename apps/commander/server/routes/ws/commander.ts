export default defineWebSocketHandler({
  open(peer) {
    peer.subscribe('commander')
    peer.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to commander WebSocket',
    }))
  },

  async message(peer, message) {
    const text = message.text()

    try {
      const data = JSON.parse(text)

      if (data.type === 'refresh') {
        // Broadcast refresh signal to all connected clients
        peer.publish('commander', JSON.stringify({
          type: 'refresh',
          timestamp: Date.now(),
        }))
      }
    }
    catch (error) {
      console.error('[ws] Failed to parse message:', error)
    }
  },

  close(peer) {
    peer.unsubscribe('commander')
  },
})
