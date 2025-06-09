import type { Buffer } from 'node:buffer'
import type { D1Database, D1PreparedStatement, D1Result } from './d1Store'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

export class WranglerD1Client implements D1Database {
  constructor(
    private databaseName: string,
  ) { }

  prepare(query: string): D1PreparedStatement {
    return new WranglerPreparedStatement(query, this.databaseName)
  }

  async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
    // Convert prepared statements to SQL with bindings resolved
    const sqlStatements: string[] = []
    for (const stmt of statements) {
      if (stmt instanceof WranglerPreparedStatement) {
        sqlStatements.push(stmt.getProcessedQuery())
      }
    }

    // Execute all statements in a single command (without transaction wrapper)
    // D1 doesn't support BEGIN TRANSACTION through wrangler CLI
    const batchQuery = sqlStatements.join(';\n')

    try {
      await this.executeWranglerCommand([
        'd1',
        'execute',
        this.databaseName,
        '--command',
        batchQuery,
        '--json',
      ])

      // Create result objects for each statement
      const results: D1Result[] = []
      for (let i = 0; i < statements.length; i++) {
        results.push({
          success: true,
          meta: {
            duration: 0,
            changes: 1,
            last_row_id: 0,
            rows_read: 0,
            rows_written: 1,
          },
          results: [],
        })
      }

      return results
    }
    catch (error) {
      // If batch fails, return error results for all statements
      const errorMessage = error instanceof Error ? error.message : 'Batch operation failed'
      console.error('[D1 Batch Error]:', errorMessage)

      // Log sample SQL for debugging
      if (sqlStatements.length > 0) {
        console.error('[D1 Sample SQL]:', `${sqlStatements[0].substring(0, 200)}...`)
      }

      return statements.map(() => ({
        success: false,
        meta: {
          duration: 0,
          changes: 0,
          last_row_id: 0,
          rows_read: 0,
          rows_written: 0,
        },
        results: [],
        error: errorMessage,
      }))
    }
  }

  async exec(query: string): Promise<any> {
    return this.executeWranglerCommand(['d1', 'execute', this.databaseName, '--command', query])
  }

  private getWranglerCommand(): string {
    const localWrangler = join(process.cwd(), 'node_modules', '.bin', 'wrangler')
    if (existsSync(localWrangler)) {
      return localWrangler
    }
    return 'npx'
  }

  private getWranglerArgs(baseArgs: string[]): string[] {
    const wranglerCmd = this.getWranglerCommand()

    if (wranglerCmd === 'npx') {
      return ['wrangler', ...baseArgs]
    }

    return baseArgs
  }

  private async executeWranglerCommand(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const wranglerCmd = this.getWranglerCommand()

      // Always use remote flag
      const fullArgs = this.getWranglerArgs([...args, '--remote'])

      // Debug logging
      if (process.env.DEBUG_WRANGLER) {
        console.error(`[Wrangler Debug] Command: ${wranglerCmd} ${fullArgs.join(' ')}`)
      }

      const child = spawn(wranglerCmd, fullArgs, {
        stdio: 'pipe',
        env: { ...process.env, NO_COLOR: '1' }, // Disable color output for cleaner error messages
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', (code: number | null) => {
        if (code === 0) {
          try {
            // Try to parse as JSON first
            if (stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
              const result = JSON.parse(stdout)
              resolve(result)
            }
            else {
              // For batch operations, just return success
              resolve({ success: true })
            }
          }
          catch {
            resolve({ success: true })
          }
        }
        else {
          // Include both stdout and stderr in error message for better debugging
          const errorDetails = stderr || stdout || 'No error details available'
          reject(new Error(`Wrangler command failed (exit code ${code}): ${errorDetails.trim()}`))
        }
      })

      child.on('error', (error: Error) => {
        reject(new Error(`Failed to spawn wrangler: ${error.message}`))
      })
    })
  }
}

class WranglerPreparedStatement implements D1PreparedStatement {
  private bindings: any[] = []

  constructor(
    private query: string,
    private databaseName: string,
  ) { }

  bind(...values: any[]): D1PreparedStatement {
    this.bindings = values
    return this
  }

  async first<T = any>(): Promise<T | null> {
    const result = await this.executeQuery()
    return result.results?.[0] || null
  }

  async run(): Promise<D1Result> {
    return this.executeQuery()
  }

  async all<T = any>(): Promise<D1Result<T>> {
    return this.executeQuery()
  }

  getProcessedQuery(): string {
    let processedQuery = this.query
    let bindingIndex = 0

    processedQuery = processedQuery.replace(/\?/g, () => {
      const value = this.bindings[bindingIndex++]
      if (value === null || value === undefined) {
        return 'NULL'
      }
      if (typeof value === 'string') {
        return `'${value.replace(/'/g, '\'\'')}'`
      }
      return String(value)
    })

    return processedQuery
  }

  private async executeQuery(): Promise<D1Result> {
    const processedQuery = this.getProcessedQuery()

    const args = ['d1', 'execute', this.databaseName, '--command', processedQuery, '--json']

    try {
      const result = await this.executeWranglerCommand(args)

      // Handle array response from wrangler
      const queryResult = Array.isArray(result) ? result[0] : result

      return {
        success: true,
        meta: {
          duration: queryResult?.meta?.duration || 0,
          changes: queryResult?.meta?.changes || queryResult?.changes || 0,
          last_row_id: queryResult?.meta?.last_row_id || queryResult?.lastRowId || 0,
          rows_read: queryResult?.meta?.rows_read || 0,
          rows_written: queryResult?.meta?.rows_written || queryResult?.changes || 0,
        },
        results: queryResult?.results || [],
      }
    }
    catch (error) {
      return {
        success: false,
        meta: {
          duration: 0,
          changes: 0,
          last_row_id: 0,
          rows_read: 0,
          rows_written: 0,
        },
        results: [],
        error: error instanceof Error ? error.message : 'Query execution failed',
      }
    }
  }

  private getWranglerCommand(): string {
    const localWrangler = join(process.cwd(), 'node_modules', '.bin', 'wrangler')
    if (existsSync(localWrangler)) {
      return localWrangler
    }
    return 'npx'
  }

  private getWranglerArgs(baseArgs: string[]): string[] {
    const wranglerCmd = this.getWranglerCommand()

    if (wranglerCmd === 'npx') {
      return ['wrangler', ...baseArgs]
    }

    return baseArgs
  }

  private async executeWranglerCommand(args: string[]): Promise<any> {
    return new Promise((resolve, reject) => {
      const wranglerCmd = this.getWranglerCommand()

      // Always use remote flag
      const fullArgs = this.getWranglerArgs([...args, '--remote'])

      // Debug logging
      if (process.env.DEBUG_WRANGLER) {
        console.error(`[Wrangler Debug] Command: ${wranglerCmd} ${fullArgs.join(' ')}`)
      }

      const child = spawn(wranglerCmd, fullArgs, {
        stdio: 'pipe',
        env: { ...process.env, NO_COLOR: '1' }, // Disable color output for cleaner error messages
      })

      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      child.on('close', (code: number | null) => {
        if (code === 0) {
          try {
            // Try to parse as JSON first
            if (stdout.trim().startsWith('{') || stdout.trim().startsWith('[')) {
              const result = JSON.parse(stdout)
              resolve(result)
            }
            else {
              // For batch operations, just return success
              resolve({ success: true })
            }
          }
          catch {
            resolve(stdout)
          }
        }
        else {
          // Include both stdout and stderr in error message for better debugging
          const errorDetails = stderr || stdout || 'No error details available'
          reject(new Error(`Wrangler command failed (exit code ${code}): ${errorDetails.trim()}`))
        }
      })

      child.on('error', (error: Error) => {
        reject(new Error(`Failed to spawn wrangler: ${error.message}`))
      })
    })
  }
}
