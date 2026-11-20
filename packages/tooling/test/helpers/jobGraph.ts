/**
 * A workflow run's job graph, played out as GitHub plays it: each job, once
 * every job it needs has ended, runs when its `if:` holds and is skipped
 * otherwise. A job's `if:` with no status function is `success() && (…)`;
 * `success()` holds when every job it needs succeeded. Enough of GitHub's
 * expression language for the workflows' conditions: `&&`, `||`, `!`, `==`,
 * `!=`, parentheses, string literals, `needs.<job>.result`,
 * `needs.<job>.outputs.<name>`, `inputs.<name>`, `contains`, `fromJSON` and
 * the status functions. Anything else throws, so a condition this cannot read
 * fails its test rather than passing it.
 */

export type Result = 'success' | 'failure' | 'cancelled' | 'skipped';

interface GraphJob {
	needs?: string | string[];
	if?: string;
}

type Value = string | boolean | unknown[] | Record<string, unknown> | null;

const TOKEN = /\s*(&&|\|\||==|!=|!|\(|\)|,|'(?:[^']|'')*'|[A-Za-z_][\w.-]*)/y;

function tokenize(expression: string): string[] {
	const tokens: string[] = [];
	TOKEN.lastIndex = 0;
	while (TOKEN.lastIndex < expression.length) {
		if (/^\s*$/.test(expression.slice(TOKEN.lastIndex))) break;
		const match = TOKEN.exec(expression);
		if (!match) throw new Error(`cannot read ${expression.slice(TOKEN.lastIndex)}`);
		tokens.push(match[1]!);
	}
	return tokens;
}

const STATUS_FUNCTION = /\b(?:success|failure|cancelled|always)\(\)/;

function truthy(value: Value) {
	return value !== false && value !== '' && value !== null;
}

function evaluate(
	expression: string,
	context: {
		needs: Record<string, { result: Result; outputs: Record<string, string> }>;
		inputs: Record<string, string>;
	},
): boolean {
	const tokens = tokenize(expression);
	let position = 0;
	const peek = () => tokens[position];
	const take = (expected?: string) => {
		const token = tokens[position++];
		if (expected !== undefined && token !== expected)
			throw new Error(`expected ${expected}, read ${token} in ${expression}`);
		return token!;
	};
	const needResults = () => Object.values(context.needs).map(({ result }) => result);

	function primary(): Value {
		const token = take();
		if (token === '(') {
			const value = or();
			take(')');
			return value;
		}
		if (token === '!') return !truthy(primary());
		if (token.startsWith("'")) return token.slice(1, -1).replaceAll("''", "'");
		if (peek() === '(') {
			take('(');
			const args: Value[] = [];
			while (peek() !== ')') {
				args.push(or());
				if (peek() === ',') take(',');
			}
			take(')');
			switch (token) {
				case 'success':
					return needResults().every((result) => result === 'success');
				case 'failure':
					return needResults().some((result) => result === 'failure');
				case 'cancelled':
					return false;
				case 'always':
					return true;
				case 'fromJSON':
					return JSON.parse(String(args[0])) as Value;
				case 'contains': {
					const [haystack, needle] = args;
					return Array.isArray(haystack)
						? haystack.includes(needle)
						: String(haystack).toLowerCase().includes(String(needle).toLowerCase());
				}
				default:
					throw new Error(`no function ${token}`);
			}
		}
		const [root, name, field, output] = token.split('.');
		if (root === 'inputs' && name) return context.inputs[name] ?? '';
		if (root === 'needs' && name) {
			const need = context.needs[name];
			if (!need) throw new Error(`${name} is not a job this one needs`);
			if (field === 'result') return need.result;
			if (field === 'outputs' && output) return need.outputs[output] ?? '';
		}
		throw new Error(`cannot read ${token}`);
	}

	function comparison(): Value {
		const left = primary();
		if (peek() === '==' || peek() === '!=') {
			const equal = take() === '==';
			const right = primary();
			return (left === right) === equal;
		}
		return left;
	}

	function and(): Value {
		let value = comparison();
		while (peek() === '&&') {
			take();
			const right = comparison();
			value = truthy(value) ? right : value;
		}
		return value;
	}

	function or(): Value {
		let value = and();
		while (peek() === '||') {
			take();
			const right = and();
			value = truthy(value) ? value : right;
		}
		return value;
	}

	const value = or();
	if (position !== tokens.length)
		throw new Error(`cannot read past ${tokens[position]} in ${expression}`);
	return truthy(value);
}

/**
 * Each job's result in a run where every job that runs ends as `ends` says
 * (success unless named), with the outputs `outputs` gives the jobs that set
 * them.
 */
export function playOut(
	jobs: Record<string, GraphJob>,
	{
		ends = {},
		outputs = {},
		inputs = {},
	}: {
		ends?: Record<string, Result>;
		outputs?: Record<string, Record<string, string>>;
		inputs?: Record<string, string>;
	},
): Record<string, Result> {
	const results: Record<string, Result> = {};
	const pending = new Set(Object.keys(jobs));
	while (pending.size > 0) {
		const ready = [...pending].filter((id) =>
			[jobs[id]!.needs ?? []].flat().every((need) => need in results),
		);
		if (ready.length === 0) throw new Error(`a cycle among ${[...pending].join(', ')}`);
		for (const id of ready) {
			const needs = Object.fromEntries(
				[jobs[id]!.needs ?? []].flat().map((need) => [
					need,
					{
						result: results[need]!,
						outputs: results[need] === 'success' ? (outputs[need] ?? {}) : {},
					},
				]),
			);
			const condition = jobs[id]!.if ?? 'success()';
			const full = STATUS_FUNCTION.test(condition) ? condition : `success() && (${condition})`;
			results[id] = evaluate(full, { needs, inputs }) ? (ends[id] ?? 'success') : 'skipped';
			pending.delete(id);
		}
	}
	return results;
}
