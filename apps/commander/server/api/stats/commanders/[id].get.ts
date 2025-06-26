export default defineEventHandler(async (event) => {
  try {
    const commanderId = getRouterParam(event, 'id')

    if (!commanderId) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Commander ID is required',
      })
    }

    const db = hubDatabase()

    // Get commander details and play count
    const commanderStats = await db
      .prepare(`
        SELECT
          commander_id,
          commander_name,
          commander_image,
          COUNT(*) as play_count,
          COUNT(DISTINCT email) as unique_players,
          MAX(submitted_at) as last_played,
          MIN(submitted_at) as first_played
        FROM submissions
        WHERE commander_id = ?1
        GROUP BY commander_id, commander_name, commander_image
      `)
      .bind(commanderId)
      .first()

    if (!commanderStats) {
      throw createError({
        statusCode: 404,
        statusMessage: 'Commander not found',
      })
    }

    // Get recent plays
    const recentPlays = await db
      .prepare(`
        SELECT
          email,
          submitted_at
        FROM submissions
        WHERE commander_id = ?1
        ORDER BY submitted_at DESC
        LIMIT 10
      `)
      .bind(commanderId)
      .all()

    // Get play frequency by day for the last 30 days
    const playsByDay = await db
      .prepare(`
        SELECT
          DATE(submitted_at, 'unixepoch') as play_date,
          COUNT(*) as plays
        FROM submissions
        WHERE commander_id = ?1
          AND submitted_at >= unixepoch('now', '-30 days')
        GROUP BY play_date
        ORDER BY play_date DESC
      `)
      .bind(commanderId)
      .all()

    return {
      success: true,
      data: {
        ...commanderStats,
        recent_plays: recentPlays.results,
        plays_by_day: playsByDay.results,
      },
    }
  }
  catch (error) {
    console.error('Commander stats error:', error)

    // Re-throw if it's already a createError
    if (error instanceof Error && 'statusCode' in error) {
      throw error
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to retrieve commander statistics',
    })
  }
})
