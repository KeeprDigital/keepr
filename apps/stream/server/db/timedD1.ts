/**
 * The D1 binding, with each statement it runs timed as one call of a write's
 * `d1` step (`server/utils/writeTiming.ts`). A statement run alone and a batch
 * are each one round trip, and one call. What it answers is the binding's own.
 */

/** Runs one call of D1, timed. */
type Timer = <T>(work: () => Promise<T>) => Promise<T>;

type Method = (...args: unknown[]) => unknown;

/** A prepared statement's methods that run it. */
const RUNS = new Set<PropertyKey>(['all', 'first', 'raw', 'run']);

export function timedD1(binding: D1Database, time: Timer): D1Database {
	// What each timed statement stands for: the binding's batch takes its own.
	const statements = new WeakMap<object, D1PreparedStatement>();

	function timedStatement(statement: D1PreparedStatement): D1PreparedStatement {
		const timed = new Proxy(statement, {
			get(target, property) {
				const value = Reflect.get(target, property, target) as unknown;
				if (typeof value !== 'function') return value;
				if (property === 'bind')
					return (...values: unknown[]) => timedStatement(target.bind(...values));
				if (RUNS.has(property))
					return async (...args: unknown[]) =>
						await time(async () => await (value as Method).apply(target, args));
				return (value as Method).bind(target);
			},
		});
		statements.set(timed, statement);
		return timed;
	}

	return new Proxy(binding, {
		get(target, property) {
			const value = Reflect.get(target, property, target) as unknown;
			if (typeof value !== 'function') return value;
			if (property === 'prepare') return (query: string) => timedStatement(target.prepare(query));
			if (property === 'batch')
				return async (batch: D1PreparedStatement[]) =>
					await time(
						async () =>
							await target.batch(batch.map((statement) => statements.get(statement) ?? statement)),
					);
			if (property === 'exec')
				return async (query: string) => await time(async () => await target.exec(query));
			return (value as Method).bind(target);
		},
	});
}
