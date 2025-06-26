// This is a test endpoint for development only
// It seeds sample data to demonstrate the statistics functionality

export default defineEventHandler(async () => {
  // This is a test endpoint - use with caution
  // In production, you should protect this endpoint

  try {
    const db = hubDatabase()

    // Sample commanders with realistic play counts
    const sampleData = [
      { name: 'Atraxa, Praetors\' Voice', id: 'c8776ea5-e8e3-4cd2-9439-5e2118d2a574', plays: 25 },
      { name: 'Edgar Markov', id: '8d94b8ec-ecda-43c1-a60e-1ba33e6a54e4', plays: 22 },
      { name: 'The Ur-Dragon', id: '7e78b70b-0c67-4f14-8ad7-c9f8e3f59743', plays: 18 },
      { name: 'Korvold, Fae-Cursed King', id: 'c1f53d7a-9dad-46e8-b686-cd1362867445', plays: 16 },
      { name: 'Muldrotha, the Gravetide', id: 'd0ec8d28-b00d-4aa1-9cd8-170579d76e5c', plays: 15 },
      { name: 'Yuriko, the Tiger\'s Shadow', id: '3bd81ae6-e628-447a-a36b-597e63ede295', plays: 14 },
      { name: 'Prossh, Skyraider of Kher', id: '889c1a0f-7df2-4497-8058-04358173d7e8', plays: 12 },
      { name: 'Krenko, Mob Boss', id: '9af7e5e7-de08-419d-8f8b-c904b397acbf', plays: 11 },
      { name: 'Animar, Soul of Elements', id: 'a3da57d0-1ae3-4f05-a52d-eb76ad56cae7', plays: 10 },
      { name: 'Breya, Etherium Shaper', id: '8b585ce8-77a3-4755-8aa6-aee83724bbab', plays: 9 },
      { name: 'Meren of Clan Nel Toth', id: '17d6703c-ad79-457b-a499-8a1fd1025c3b', plays: 8 },
      { name: 'Gitrog Monster', id: '5790dd89-2be5-4a77-9450-2d3c1422bfc9', plays: 7 },
    ]

    // Different email addresses
    const emails = [
      'player1@example.com',
      'player2@example.com',
      'player3@example.com',
      'player4@example.com',
      'player5@example.com',
    ]

    let insertedCount = 0

    // Insert sample plays
    for (const commander of sampleData) {
      for (let i = 0; i < commander.plays; i++) {
        const randomEmail = emails[Math.floor(Math.random() * emails.length)]
        const randomDaysAgo = Math.floor(Math.random() * 30) // Random date within last 30 days
        const submittedAt = Math.floor(Date.now() / 1000) - (randomDaysAgo * 24 * 60 * 60)

        await db
          .prepare(`
            INSERT INTO submissions (email, commander_id, commander_name, commander_image, submitted_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
          `)
          .bind(
            randomEmail,
            commander.id,
            commander.name,
            `https://cards.scryfall.io/art_crop/front/${commander.id.charAt(0)}/${commander.id.charAt(1)}/${commander.id}.jpg?${Date.now()}`,
            submittedAt,
          )
          .run()

        insertedCount++
      }
    }

    return {
      success: true,
      message: `Seeded ${insertedCount} sample submissions`,
    }
  }
  catch (error) {
    console.error('Seed error:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Failed to seed data',
    })
  }
})
