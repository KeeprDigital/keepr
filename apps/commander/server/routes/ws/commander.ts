export default defineWebSocketHandler({
  open(peer) {
    peer.subscribe('commander')
    sendUpdate(peer)
  },

  async message(peer, message) {
    const text = message.text()

    try {
      const data = JSON.parse(text)

      if (data.type === 'refresh') {
        await broadcastUpdate(peer)
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

// Send update to a specific peer
async function sendUpdate(peer: any) {
  try {
    const data = await getLatestData()
    peer.send(JSON.stringify({
      type: 'update',
      ...data,
    }))
  }
  catch (error) {
    console.error('[ws] Failed to send update:', error)
  }
}

// Broadcast update to all connected clients
async function broadcastUpdate(peer: any) {
  try {
    const data = await getLatestData()
    peer.publish('commander', JSON.stringify({
      type: 'update',
      ...data,
    }))
  }
  catch (error) {
    console.error('[ws] Failed to broadcast update:', error)
  }
}

// Get latest data from database
async function getLatestData() {
  const db = hubDatabase()

  const [submissions, stats] = await Promise.all([
    db.prepare(`
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
    `).all(),

    db.prepare(`
      SELECT
        commander_id,
        MAX(commander_name) as commander_name,
        MAX(commander_image) as commander_image,
        COUNT(*) as play_count,
        COUNT(DISTINCT email) as unique_players,
        MAX(submitted_at) as last_played
      FROM submissions
      GROUP BY commander_id
      ORDER BY play_count DESC
      LIMIT 10
    `).all(),
  ])

  return {
    submissions: submissions.results || [],
    stats: stats.results || [],
  }
}
