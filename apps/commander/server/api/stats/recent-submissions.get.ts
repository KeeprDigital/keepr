export default defineEventHandler(async () => {
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

  return result.results || []
})
