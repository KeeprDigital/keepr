/**
 * The Worker the object's tests drive: the class as an app exports it, the
 * same class on a clock a test moves, and a door that grants whatever the test
 * asks for. Only a test may be that trusting.
 */
import { REFUSED_HEADER, TICKET_HEADER } from '../../../src/object/handOff.ts';
import { connectSocket, RealtimeObject, refuseSocket } from '../../../src/object/index.ts';
import type { Grant, RealtimeObjectOptions } from '../../../src/object/index.ts';

export { RealtimeObject };

/** How many times each object was constructed, which is how often it woke. */
const wakes = new Map<string, number>();

/**
 * Each object's clock, as a test moves it: from each moment of real time on, how
 * far ahead of it the object's clock stands. Kept here, so a clock outlasts the
 * object's sleep and restart as real time does.
 */
const clocks = new Map<string, { from: number; ahead: number }[]>();

/** How far ahead an object's clock stood at real moment `at`. */
function aheadAt(id: string, at: number): number {
	let ahead = 0;
	for (const step of clocks.get(id) ?? []) if (step.from <= at) ahead = step.ahead;
	return ahead;
}

/** The object at its defaults, with what a test needs to see of it. */
export class Observed extends RealtimeObject<Env> {
	constructor(ctx: DurableObjectState, env: Env, options?: RealtimeObjectOptions) {
		super(ctx, env, options);
		const id = ctx.id.toString();
		wakes.set(id, (wakes.get(id) ?? 0) + 1);
	}

	/** The object's clock: real time, and whatever a test moved it on by. */
	protected override now(): number {
		const real = Date.now();
		return real + aheadAt(this.ctx.id.toString(), real);
	}

	/** A ping's time on the object's clock as it stood when the runtime answered it. */
	protected override pingedAt(socket: WebSocket): number {
		const real = super.pingedAt(socket);
		return real === 0 ? 0 : real + aheadAt(this.ctx.id.toString(), real);
	}

	/**
	 * Move the object's clock on by `ms`, and run the alarm as the runtime would
	 * then, the alarm set taken off first as the runtime takes it. With `alarm`
	 * false the clock moves and nothing runs.
	 */
	async advance(ms: number, alarm = true): Promise<void> {
		const id = this.ctx.id.toString();
		const steps = clocks.get(id) ?? [];
		steps.push({ from: Date.now(), ahead: aheadAt(id, Date.now()) + ms });
		clocks.set(id, steps);
		if (!alarm) return;
		await this.ctx.storage.deleteAlarm();
		await this.alarm();
	}

	/** What the object keeps in storage, by table. */
	stored(): { log: number; head: number; withdrawn: number; member: number; epoch: boolean } {
		const count = (table: string): number =>
			this.ctx.storage.sql.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).one().n;
		return {
			log: count('log'),
			head: count('head'),
			withdrawn: count('withdrawn'),
			member: count('member'),
			epoch: this.ctx.storage.kv.get('epoch') !== undefined,
		};
	}

	wakes(): number {
		return wakes.get(this.ctx.id.toString()) ?? 0;
	}

	async alarmAt(): Promise<number | null> {
		return this.ctx.storage.getAlarm();
	}

	/** Empty its storage, as a deleted object's would be. Evict it to see it start again. */
	async wipe(): Promise<void> {
		await this.ctx.storage.deleteAll();
	}
}

type Binding = keyof Env;
const isBinding = (env: Env, name: string | undefined): name is Binding =>
	name !== undefined && name in env;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const [door, binding, scope, method] = url.pathname.split('/').slice(1);
		if (!isBinding(env, binding) || !scope) return new Response('Not found', { status: 404 });
		const stub = env[binding].getByName(scope);

		// As an app's Worker does it: it decides the grant, or refuses.
		if (door === 'connect') {
			const grant = url.searchParams.get('grant');
			if (grant === null) return refuseSocket();
			try {
				return await connectSocket(stub, request, JSON.parse(grant) as Grant);
			} catch (error) {
				// A grant the object will not hold is the app's defect: here, the test's to see.
				return new Response(String(error), { status: 500 });
			}
		}
		// What no app does: the request as it came, straight to the object.
		if (door === 'bare') return stub.fetch(request);
		// Nor this: a ticket the test holds, put where `connectSocket` puts its own.
		if (door === 'ticket') {
			const carrying = new Request(request);
			carrying.headers.set(TICKET_HEADER, url.searchParams.get('ticket') ?? '');
			const answer = await stub.fetch(carrying);
			// As `connectSocket` reads it, unless the test asks for the object's own answer.
			if (url.searchParams.has('raw') || answer.headers.get(REFUSED_HEADER) === null) return answer;
			return refuseSocket();
		}
		if (door === 'call' && method) {
			const methods = stub as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
			const answer = await methods[method]?.(...((await request.json()) as unknown[]));
			return Response.json(answer ?? null);
		}
		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
