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
