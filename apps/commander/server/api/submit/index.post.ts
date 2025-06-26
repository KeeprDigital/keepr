import { getIO } from '~~/server/plugins/ws.server'

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event)

    // Validate the request body
    if (!body.email || !body.commander || !body.commander.id || !body.commander.name || !body.commander.image) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid request data',
      })
    }

    // Get the database instance
    const db = hubDatabase()

    // Insert the submission into the database
    const result = await db
      .prepare('INSERT INTO submissions (email, commander_id, commander_name, commander_image) VALUES (?1, ?2, ?3, ?4)')
      .bind(body.email, body.commander.id, body.commander.name, body.commander.image)
      .run()

    if (!result.success) {
      throw createError({
        statusCode: 500,
        statusMessage: 'Failed to save submission',
      })
    }

    // Emit WebSocket event for new submission
    try {
      const io = getIO()
      const commanderNamespace = io.of('/commander')

      // Create submission object
      const submission: CommanderSubmission = {
        id: Number(result.meta.last_row_id),
        email: body.email,
        commander_id: body.commander.id,
        commander_name: body.commander.name,
        commander_image: body.commander.image,
        submitted_at: Math.floor(Date.now() / 1000),
      }

      // Emit to all subscribed clients
      commanderNamespace.to('updates').emit('newSubmission', submission)

      // Also get and emit updated stats
      const statsResult = await db
        .prepare(`
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
        `)
        .all()

      if (statsResult.results) {
        commanderNamespace.to('updates').emit('statsUpdated', statsResult.results as StatsUpdate[])
      }
    }
    catch (wsError) {
      // Log WebSocket error but don't fail the submission
      console.error('WebSocket emit error:', wsError)
    }

    return {
      success: true,
      message: 'Form submitted successfully',
      submissionId: result.meta.last_row_id,
    }
  }
  catch (error) {
    console.error('Submission error:', error)

    // Re-throw if it's already a createError
    if (error instanceof Error && 'statusCode' in error) {
      throw error
    }

    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to process form submission',
    })
  }
})
