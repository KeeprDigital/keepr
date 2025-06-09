import process from 'node:process'

export type D1Config = {
  databaseName: string
}

export function getD1Config(): D1Config {
  const databaseName = process.env.D1_DATABASE_NAME || 'op-tcg-cards'

  return {
    databaseName,
  }
}
