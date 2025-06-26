export default defineEventHandler(async (event) => {
  try {
    const db = hubDatabase()

    // Get query parameters for filtering
    const query = getQuery(event)
    const limit = Number(query.limit) || 10
    const offset = Number(query.offset) || 0

    // Query to get commander play counts
    const stats = await db
      .prepare(`
        SELECT
          commander_id,
          commander_name,
          commander_image,
          COUNT(*) as play_count,
          COUNT(DISTINCT email) as unique_players,
          MAX(submitted_at) as last_played
        FROM submissions
        GROUP BY commander_id, commander_name, commander_image
        ORDER BY play_count DESC
        LIMIT ?1 OFFSET ?2
      `)
      .bind(limit, offset)
      .all()

    // Get total count for pagination
    const totalResult = await db
      .prepare('SELECT COUNT(DISTINCT commander_id) as total FROM submissions')
      .first()

    return {
      success: true,
      data: stats.results,
      pagination: {
        limit,
        offset,
        total: totalResult?.total || 0,
      },
    }
  }
  catch (error) {
    console.error('Stats error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to retrieve commander statistics',
    })
  }
})
