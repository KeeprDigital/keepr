import type { BulkClockAction, PlayerSide, ResetType, Seat } from '~~/shared/types/enums';
import type {
	FeatureMatchBatchSubCommand,
	FeatureMatchSessionCommand,
	FeatureMatchSessionCommandResult,
	FeatureMatchSessionResponse,
} from '~~/shared/types/featureMatchSession';
import type {
	CommanderSource,
	FeatureMatchOutcome,
	FeatureMatchState,
	GameWinOptions,
	PlayerFeatureMatchStateUpdate,
} from '~~/shared/types/featureMatchState';
import { isCoveredByBulkClockAction, pairSeatOf } from '~~/shared/modules/feature-match-session';
import { randomCommandId, randomUuid } from '~~/shared/utils/uuid';
import { failureStatus } from '@keepr/nuxt-layer/app/utils/failureStatus';
import { useFeatureMatchStateRepository } from '~/composables/repositories/useFeatureMatchStateRepository';
import { createKeyedQueue } from '~/utils/keyedQueue';

export interface FeatureMatchResetOptions {
	type: ResetType;
	startingLife?: number;
}

export interface BulkClockUpdate {
	featureMatchId: number;
	featureMatchState: FeatureMatchState;
	session: FeatureMatchSessionResponse;
	sessionId: number;
	sequence: number;
}

export interface FeatureMatchCommandStateResult {
	featureMatchState: FeatureMatchState;
	session: FeatureMatchSessionResponse;
	sequence: number;
}

/** The per-player fields a state save can set. */
export interface FeatureMatchPlayerStatePatch {
	lifeTotal?: number;
	counters?: FeatureMatchState['player1']['counters'];
	cardsKept?: number;
	sideboardRevealed?: boolean;
}

/**
 * A partial-state save. Only the fields present claim ownership, and every
 * field here maps to a setter command — the type admits nothing the seam
 * would silently drop. The clock field is the reading the operator sees
 * (`SetClock` targets display time), not raw elapsed milliseconds.
 */
export interface FeatureMatchStateUpdate {
	player1?: FeatureMatchPlayerStatePatch;
	player2?: FeatureMatchPlayerStatePatch;
	clock?: { targetDisplayMs: number };
	/** Any Seat of a Commander Session; one of the pair on every other. */
	firstPlayer?: Seat;
	activePlayer?: Seat | null;
	turnNumber?: number;
	overtime?: { totalTurns: number };
}

const PLAYER_SIDES: readonly PlayerSide[] = ['player1', 'player2'];

function toCommandStateResult(
	result: FeatureMatchSessionCommandResult,
): FeatureMatchCommandStateResult {
	return {
		featureMatchState: result.currentState,
		session: result.session,
		sequence: result.sequence,
	};
}

function sessionStateResult(session: FeatureMatchSessionResponse): FeatureMatchCommandStateResult {
	return {
		featureMatchState: session.currentState,
		session,
		sequence: session.sequence,
	};
}

/**
 * Decompose a partial-state update into the setter commands that express it.
 * The order mirrors the serial sends this replaced: player fields, clock,
 * first/active player, turn number, overtime — so a batch reduces to exactly
 * the state the serial commands produced.
 */
function buildStateUpdateCommands(update: FeatureMatchStateUpdate): FeatureMatchBatchSubCommand[] {
	const commands: FeatureMatchBatchSubCommand[] = [];

	for (const player of PLAYER_SIDES) {
		const patch = update[player];
		if (!patch) continue;
		if (patch.lifeTotal !== undefined) {
			commands.push({
				type: 'SetLife',
				payload: { player, lifeTotal: patch.lifeTotal },
			});
		}
		if (patch.counters !== undefined) {
			commands.push({
				type: 'SetCounters',
				payload: { player, counters: patch.counters },
			});
		}
		if (patch.cardsKept !== undefined) {
			commands.push({
				type: 'SetCardsKept',
				payload: { player, cardsKept: patch.cardsKept },
			});
		}
		if (patch.sideboardRevealed !== undefined) {
			commands.push({
				type: 'SetSideboardRevealed',
				payload: { player, revealed: patch.sideboardRevealed },
			});
		}
	}

	if (update.clock !== undefined) {
		commands.push({
			type: 'SetClock',
			payload: { targetMs: update.clock.targetDisplayMs },
		});
	}

	const { firstPlayer, activePlayer, turnNumber } = update;
	const selectsInitialFirstPlayer =
		firstPlayer !== undefined && activePlayer === firstPlayer && turnNumber === 1;
	if (firstPlayer) {
		commands.push(
			selectsInitialFirstPlayer
				? {
						type: 'SelectFirstPlayer',
						payload: { player: firstPlayer },
					}
				: {
						type: 'SetFirstPlayer',
						payload: { player: firstPlayer },
					},
		);
	}
	if (activePlayer !== undefined && !selectsInitialFirstPlayer) {
		commands.push({
			type: 'SetActivePlayer',
			payload: { player: activePlayer },
		});
	}
	if (turnNumber !== undefined && !selectsInitialFirstPlayer) {
		commands.push({
			type: 'SetTurnNumber',
			payload: { turnNumber },
		});
	}
	if (update.overtime !== undefined) {
		commands.push({
			type: 'StartOvertime',
			payload: { totalTurns: update.overtime.totalTurns },
		});
	}

	return commands;
}

function createBulkClockCommand(
	action: BulkClockAction,
	session: FeatureMatchSessionResponse,
	commandId: string,
	deltaMs?: number,
): FeatureMatchSessionCommand | null {
	switch (action) {
		case 'start':
			return {
				commandId,
				type: 'StartClock',
				payload: {},
				baseSequence: session.sequence,
			};
		case 'pause':
			return {
				commandId,
				type: 'PauseClock',
				payload: {},
				baseSequence: session.sequence,
			};
		case 'reset':
			return {
				commandId,
				type: 'ResetClock',
				payload: {},
				baseSequence: session.sequence,
			};
		case 'restart':
			return {
				commandId,
				type: 'RestartClock',
				payload: {},
				baseSequence: session.sequence,
			};
		case 'adjust':
			return deltaMs === undefined
				? null
				: {
						commandId,
						type: 'AdjustClock',
						payload: { deltaMs },
					};
	}
}

export interface FeatureMatchSessionClientOptions {
	/** The Session the page holds for a Slot: what an absolute command claims to have seen. */
	heldSession?: (slotId: number) => FeatureMatchSessionResponse | undefined;
	/** A Session the client re-read after a refusal, for the page to hold. */
	onReread?: (session: FeatureMatchSessionResponse) => void;
}

/** The newer of two Sessions of one Slot: a later epoch, else a later sequence (ADR-0026). */
function newerSession(
	a: FeatureMatchSessionResponse | undefined,
	b: FeatureMatchSessionResponse | undefined,
): FeatureMatchSessionResponse | undefined {
	if (!a || !b) return a ?? b;
	if (a.id !== b.id) return a.id > b.id ? a : b;
	return a.sequence >= b.sequence ? a : b;
}

/**
 * Client-side Feature Match Session seam.
 *
 * The repository is the HTTP adapter. This Module owns command construction,
 * command sequencing, and bulk command orchestration so stores depend on one
 * deep Interface instead of route payload details.
 *
 * A command claims the Session the page holds, so one the operator sent from a
 * view the Session has moved past is refused, and the Slot is re-read only
 * then. A Slot's commands go one at a time, each claiming the Session the one
 * before it left, so an operator's own quick taps never refuse each other.
 */
export function useFeatureMatchSessionClient(options: FeatureMatchSessionClientOptions = {}) {
	const repository = useFeatureMatchStateRepository();
	const queue = createKeyedQueue<number>();
	/** The Session each Slot's latest answer carried, which the page may not hold yet. */
	const answered = new Map<number, FeatureMatchSessionResponse>();
	/** How many of each Slot's commands were refused: one queued before a refusal was made from the view refused. */
	const refusals = new Map<number, number>();

	const ensureSession = async (
		eventId: number,
		slotId: number,
	): Promise<FeatureMatchSessionResponse | null> => {
		const slot = await repository.getSlot(eventId, slotId);
		if (!slot) return null;
		return slot.activeSession ?? (await repository.createSession(eventId, slotId));
	};

	/** The Session a command for the Slot claims: the newest this page knows, read only when it knows none. */
	const knownSession = async (
		eventId: number,
		slotId: number,
	): Promise<FeatureMatchSessionResponse> => {
		const known = newerSession(options.heldSession?.(slotId), answered.get(slotId));
		const session = known ?? (await ensureSession(eventId, slotId));
		if (!session) throw new Error('Feature match session not found');
		return session;
	};

	/** One command for a Slot, after every earlier one for it has settled. */
	const sendToSlot = (
		eventId: number,
		slotId: number,
		command: (session: FeatureMatchSessionResponse) => FeatureMatchSessionCommand | null,
	): Promise<FeatureMatchCommandStateResult> => {
		const refusedBefore = refusals.get(slotId) ?? 0;
		return queue.enqueue(slotId, async () => {
			const session = await knownSession(eventId, slotId);
			const built = command(session);
			if (!built) return sessionStateResult(session);
			// An absolute command queued behind a refused one was made from the same stale view.
			if (built.baseSequence !== undefined && (refusals.get(slotId) ?? 0) !== refusedBefore)
				throw Object.assign(new Error('Feature match session has advanced'), { statusCode: 409 });
			try {
				const result = toCommandStateResult(
					await repository.sendCommand(eventId, session.id, built),
				);
				answered.set(slotId, newerSession(answered.get(slotId), result.session)!);
				return result;
			} catch (error) {
				// Refused: the page is behind, so it takes the Session as it now stands.
				if (failureStatus(error) === 409) {
					refusals.set(slotId, (refusals.get(slotId) ?? 0) + 1);
					await reread(eventId, slotId);
				}
				throw error;
			}
		});
	};

	const reread = async (eventId: number, slotId: number) => {
		const session = await ensureSession(eventId, slotId).catch(() => null);
		if (!session) return;
		answered.set(slotId, session);
		options.onReread?.(session);
	};

	const sendSlotCommand = (
		eventId: number,
		slotId: number,
		createCommand: (session: FeatureMatchSessionResponse) => FeatureMatchSessionCommand,
	): Promise<FeatureMatchCommandStateResult> => sendToSlot(eventId, slotId, createCommand);

	const loadState = async (eventId: number, slotId: number): Promise<FeatureMatchState | null> => {
		const session = await ensureSession(eventId, slotId);
		return session?.currentState ?? null;
	};

	/**
	 * One save, one command. The update decomposes into the same setter commands
	 * it always has, but they travel inside a single `Batch` (or alone, when only
	 * one field changed) against one ensured session — so the request count is
	 * bounded regardless of how many fields the operator edited, and the server
	 * applies the whole save atomically or not at all.
	 */
	const updateState = (
		eventId: number,
		slotId: number,
		update: FeatureMatchStateUpdate,
	): Promise<FeatureMatchCommandStateResult> => {
		const commands = buildStateUpdateCommands(update);
		return sendToSlot(eventId, slotId, (session) => {
			if (commands.length === 0) return null;
			return commands.length === 1
				? ({
						...commands[0]!,
						commandId: randomCommandId(commands[0]!.type),
						baseSequence: session.sequence,
					} as FeatureMatchSessionCommand)
				: {
						commandId: randomCommandId('Batch'),
						type: 'Batch',
						payload: { commands },
						baseSequence: session.sequence,
					};
		});
	};

	const startClock = (eventId: number, slotId: number) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('StartClock'),
			type: 'StartClock',
			payload: {},
			baseSequence: session.sequence,
		}));

	const pauseClock = (eventId: number, slotId: number) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('PauseClock'),
			type: 'PauseClock',
			payload: {},
			baseSequence: session.sequence,
		}));

	const resetClock = (eventId: number, slotId: number) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('ResetClock'),
			type: 'ResetClock',
			payload: {},
			baseSequence: session.sequence,
		}));

	const restartClock = (eventId: number, slotId: number) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('RestartClock'),
			type: 'RestartClock',
			payload: {},
			baseSequence: session.sequence,
		}));

	const adjustClock = (eventId: number, slotId: number, deltaMs: number) =>
		sendSlotCommand(eventId, slotId, () => ({
			commandId: randomCommandId('AdjustClock'),
			type: 'AdjustClock',
			payload: { deltaMs },
		}));

	const setClock = (eventId: number, slotId: number, targetMs: number) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('SetClock'),
			type: 'SetClock',
			payload: { targetMs },
			baseSequence: session.sequence,
		}));

	const bulkClockAction = async (
		eventId: number,
		action: BulkClockAction,
		deltaMs?: number,
	): Promise<{ updates: BulkClockUpdate[] }> => {
		const slots = await repository.listSlots(eventId);
		const bulkId = randomUuid();
		const updates: BulkClockUpdate[] = [];

		for (const slot of slots) {
			// The page's own view of a Slot it holds, the listing's of one it does not.
			const listed = newerSession(
				slot.activeSession ?? undefined,
				newerSession(options.heldSession?.(slot.id), answered.get(slot.id)),
			);
			if (!listed || !isCoveredByBulkClockAction(listed.currentState)) continue;

			let sent = false;
			const result = await sendToSlot(eventId, slot.id, (session) => {
				const command = createBulkClockCommand(
					action,
					session,
					`bulk:${bulkId}:${session.id}:${action}`,
					deltaMs,
				);
				sent = command !== null;
				return command;
			});
			if (!sent) continue;
			updates.push({
				featureMatchId: slot.id,
				featureMatchState: result.featureMatchState,
				session: result.session,
				sessionId: result.session.id,
				sequence: result.sequence,
			});
		}

		return { updates };
	};

	const updatePlayerFeatureMatchState = async (
		eventId: number,
		slotId: number,
		player: Seat,
		update: PlayerFeatureMatchStateUpdate,
	): Promise<FeatureMatchCommandStateResult> => {
		let result: FeatureMatchCommandStateResult | null = null;
		if (update.lifeDelta !== undefined) {
			result = await sendSlotCommand(eventId, slotId, () => ({
				commandId: randomCommandId('AdjustLife'),
				type: 'AdjustLife',
				payload: { player, delta: update.lifeDelta! },
			}));
		} else if (update.lifeTotal !== undefined) {
			const lifeTotal = update.lifeTotal;
			result = await sendSlotCommand(eventId, slotId, (session) => ({
				commandId: randomCommandId('SetLife'),
				type: 'SetLife',
				payload: { player, lifeTotal },
				baseSequence: session.sequence,
			}));
		}

		if (update.counters !== undefined) {
			const counters = update.counters;
			result = await sendSlotCommand(eventId, slotId, (session) => ({
				commandId: randomCommandId('SetCounters'),
				type: 'SetCounters',
				payload: { player, counters },
				baseSequence: session.sequence,
			}));
		}
		if (update.cardsKept !== undefined) {
			const cardsKept = update.cardsKept;
			result = await sendSlotCommand(eventId, slotId, (session) => ({
				commandId: randomCommandId('SetCardsKept'),
				type: 'SetCardsKept',
				payload: { player, cardsKept },
				baseSequence: session.sequence,
			}));
		}
		// A Sideboard reveal is one of the pair's: a Commander Session has none (ADR-0087).
		const side = pairSeatOf(player);
		if (update.sideboardRevealed !== undefined && side) {
			const revealed = update.sideboardRevealed;
			result = await sendSlotCommand(eventId, slotId, (session) => ({
				commandId: randomCommandId('SetSideboardRevealed'),
				type: 'SetSideboardRevealed',
				payload: { player: side, revealed },
				baseSequence: session.sequence,
			}));
		}

		if (!result) throw new Error('No player state update supplied');
		return result;
	};

	const recordGameWin = (
		eventId: number,
		slotId: number,
		player: PlayerSide,
		options: GameWinOptions = {},
	) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('RecordGameWin'),
			type: 'RecordGameWin',
			payload: { player, ...options },
			baseSequence: session.sequence,
		}));

	const undoGameWin = (
		eventId: number,
		slotId: number,
		player: PlayerSide,
		options: GameWinOptions = {},
	) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('UndoGameWin'),
			type: 'UndoGameWin',
			payload: { player, ...options },
			baseSequence: session.sequence,
		}));

	const resetMatch = (eventId: number, slotId: number, options: FeatureMatchResetOptions) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('ResetState'),
			type: 'ResetState',
			payload: options,
			baseSequence: session.sequence,
		}));

	const swapPlayers = (eventId: number, slotId: number) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('SwapPlayers'),
			type: 'SwapPlayers',
			payload: {},
			baseSequence: session.sequence,
		}));

	/** Any page may ask once the clock runs out: the server starts extra turns once. */
	const startOvertime = (eventId: number, slotId: number, totalTurns: number) =>
		sendSlotCommand(eventId, slotId, () => ({
			commandId: randomCommandId('StartOvertime'),
			type: 'StartOvertime',
			payload: { totalTurns },
		}));

	// ── A Commander Session's own commands (ADR-0087) ──

	/** Relative, as a life adjustment is: it merges onto whatever landed first. */
	const adjustCommanderDamage = (
		eventId: number,
		slotId: number,
		player: Seat,
		source: CommanderSource,
		delta: number,
	) =>
		sendSlotCommand(eventId, slotId, () => ({
			commandId: randomCommandId('AdjustCommanderDamage'),
			type: 'AdjustCommanderDamage',
			payload: {
				player,
				from: source.seat,
				commander: source.commander,
				delta,
			},
		}));

	const setEliminated = (eventId: number, slotId: number, player: Seat, eliminated: boolean) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('SetEliminated'),
			type: 'SetEliminated',
			payload: { player, eliminated },
			baseSequence: session.sequence,
		}));

	/** Declares a winning Seat or a draw (`{ winner: null }`); `null` takes the outcome back. */
	const setOutcome = (eventId: number, slotId: number, outcome: FeatureMatchOutcome | null) =>
		sendSlotCommand(eventId, slotId, (session) => ({
			commandId: randomCommandId('SetOutcome'),
			type: 'SetOutcome',
			payload: { outcome },
			baseSequence: session.sequence,
		}));

	const stepTurn = (eventId: number, slotId: number, delta: number) =>
		sendSlotCommand(eventId, slotId, () => ({
			commandId: randomCommandId('StepTurn'),
			type: 'StepTurn',
			payload: { delta },
		}));

	const stepOvertime = (eventId: number, slotId: number, delta: number) =>
		sendSlotCommand(eventId, slotId, () => ({
			commandId: randomCommandId('StepOvertime'),
			type: 'StepOvertime',
			payload: { delta },
		}));

	return {
		loadState,
		updateState,
		startClock,
		pauseClock,
		resetClock,
		restartClock,
		adjustClock,
		setClock,
		bulkClockAction,
		updatePlayerFeatureMatchState,
		recordGameWin,
		undoGameWin,
		resetMatch,
		swapPlayers,
		startOvertime,
		stepTurn,
		stepOvertime,
		adjustCommanderDamage,
		setEliminated,
		setOutcome,
		ensureSession,
	};
}
