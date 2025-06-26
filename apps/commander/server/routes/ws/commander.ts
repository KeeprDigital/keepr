export default defineWebSocketHandler({
  async open(peer) {
    peer.subscribe('commander')

    try {
      const db = hubDatabase()
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

      peer.send(JSON.stringify({
        type: 'recentSubmissions',
        data: result.results || [],
      }))
    }
    catch (error) {
      console.error('[ws] Failed to get recent submissions:', error)
    }
  },

  async message(peer) {
    await broadcastRefresh(peer)
  },

  close(peer) {
    peer.unsubscribe('commander')
  },
})

async function broadcastRefresh(peer: any) {
  try {
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

    peer.publish('commander', JSON.stringify({
      type: 'update',
      submissions: submissions.results || [],
      stats: stats.results || [],
    }))
  }
  catch (error) {
    console.error('[ws] Failed to broadcast refresh:', error)
  }
}
