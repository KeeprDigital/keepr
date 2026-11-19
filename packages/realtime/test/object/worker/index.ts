/**
 * The Worker the object's tests drive: the class as an app exports it, the
 * same class under timings short enough to wait out, and a door that grants
 * whatever the test asks for. Only a test may be that trusting.
 */
import { connectSocket, RealtimeObject, refuseSocket } from '../../../src/object/index.ts';
import type { Grant, RealtimeObjectOptions } from '../../../src/object/index.ts';
import {
	ASKED_SWEEP_MS,
	BRIEF_ASK_MS,
	BRIEF_GRACE_MS,
	BRIEF_RETENTION_MS,
	BRIEF_SWEEP_MS,
} from '../timings.ts';

export { RealtimeObject };

/** How many times each object was constructed, which is how often it woke. */
const wakes = new Map<string, number>();

/** The object at its defaults, with what a test needs to see of it. */
export class Observed extends RealtimeObject<Env> {
	constructor(ctx: DurableObjectState, env: Env, options?: RealtimeObjectOptions) {
		super(ctx, env, options);
		const id = ctx.id.toString();
		wakes.set(id, (wakes.get(id) ?? 0) + 1);
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

export class BriefLog extends Observed {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, { retentionMs: BRIEF_RETENTION_MS });
	}
}

export class BriefGrace extends Observed {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, { graceMs: BRIEF_GRACE_MS });
	}
}

export class BriefSweep extends Observed {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, { sweepMs: BRIEF_SWEEP_MS });
	}
}

export class BriefAsk extends Observed {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env, { askMs: BRIEF_ASK_MS, sweepMs: ASKED_SWEEP_MS });
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
		if (door === 'call' && method) {
			const methods = stub as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;
			const answer = await methods[method]?.(...((await request.json()) as unknown[]));
			return Response.json(answer ?? null);
		}
		return new Response('Not found', { status: 404 });
	},
} satisfies ExportedHandler<Env>;
