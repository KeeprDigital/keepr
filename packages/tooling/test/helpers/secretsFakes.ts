import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';

/**
 * What the fake `op`, `wrangler` and `gh` hold, in one JSON file each reads and
 * writes: the 1Password items by vault and title (field label to value), each
 * Worker's secrets by the name Wrangler would resolve, each GitHub
 * environment's secrets, and every call's arguments.
 */
export type FakeState = {
	vaults: Record<string, Record<string, Record<string, string>>>;
	workers: Record<string, Record<string, string>>;
	github: Record<string, Record<string, string>>;
	argv: string[][];
	/** Set to make that tool fail as it does when signed out. */
	signedOut?: Partial<Record<'op' | 'wrangler' | 'gh', true>>;
	/** Set to make `op item edit` exit 0 and store nothing. */
	opDropsEdits?: true;
};

const STATE_IO = `
const { readFileSync, writeFileSync } = require('node:fs');
const statePath = process.env.FAKE_SECRETS_STATE;
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const args = process.argv.slice(2);
state.argv.push(args);
const save = () => writeFileSync(statePath, JSON.stringify(state));
const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const fail = (message) => { save(); process.stderr.write(message + '\\n'); process.exit(1); };
const stdin = () => readFileSync(0, 'utf8');
`;

/**
 * 1Password's CLI as 2.42 behaves: \`item get <item> --vault <v> --format json --reveal\`,
 * and \`item edit <item> --vault <v> 'FIELD[password]=value'\`. Like the real
 * one, it exits 0 on the item's JSON piped to \`item edit\` and keeps no value
 * from it.
 */
const OP = `${STATE_IO}
if (state.signedOut?.op) fail('[ERROR] You are not currently signed in.');
const [noun, verb, title] = args;
const vault = state.vaults[at('--vault')];
const item = vault?.[title];
if (!item) fail('[ERROR] "' + title + '" isn\\'t an item in the "' + at('--vault') + '" vault.');
if (noun === 'item' && verb === 'get' && at('--format') === 'json' && args.includes('--reveal')) {
	const fields = Object.entries(item).map(([label, value], index) => ({
		id: 'f' + index, type: 'CONCEALED', label, ...(value === '' ? {} : { value }),
	}));
	fields.unshift({ id: 'notesPlain', type: 'STRING', purpose: 'NOTES', label: 'notesPlain' });
	save();
	process.stdout.write(JSON.stringify({ id: 'x', title, category: 'SECURE_NOTE', fields }));
} else if (noun === 'item' && verb === 'edit' && args[3] === '--vault') {
	const assignments = args.slice(5);
	// The item's JSON piped in: taken, exit 0, and no concealed value kept.
	if (assignments.length === 0) stdin();
	for (const assignment of assignments) {
		const equals = assignment.indexOf('=');
		const label = assignment.slice(0, equals).replace(/\\[password\\]$/, '');
		if (equals < 0 || !(label in item)) fail('fake op: unexpected assignment');
		if (!state.opDropsEdits) item[label] = assignment.slice(equals + 1);
	}
	save();
} else fail('fake op: unexpected ' + args.join(' '));
`;

/** Wrangler's \`secret list --format json\` and \`secret bulk\` (JSON on stdin), naming the Worker as Wrangler does. */
const WRANGLER = `${STATE_IO}
// Signed out, it echoes what it was given, as a careless tool might.
if (state.signedOut?.wrangler) fail('✘ [ERROR] Not logged in. ' + stdin());
const config = JSON.parse(readFileSync(at('--config'), 'utf8'));
const env = at('--env');
const name = at('--name');
const worker = name && env ? name + '-' + env : name ?? (env ? config.env?.[env]?.name : undefined) ?? config.name;
if (!worker) fail('✘ [ERROR] Required Worker name missing.');
if (args[0] === 'secret' && args[1] === 'list' && at('--format') === 'json') {
	if (!state.workers[worker]) fail('✘ [ERROR] Worker "' + worker + '" not found.');
	save();
	process.stdout.write(JSON.stringify(Object.keys(state.workers[worker]).map((name) => ({ name, type: 'secret_text' }))));
} else if (args[0] === 'secret' && args[1] === 'bulk' && args[2]?.startsWith('-')) {
	state.workers[worker] = { ...state.workers[worker], ...JSON.parse(stdin()) };
	save();
} else fail('fake wrangler: unexpected ' + args.join(' '));
`;

/** GitHub's CLI: \`secret list --env <e> --json name\` and \`secret set <NAME> --env <e>\` with the value on stdin. */
const GH = `${STATE_IO}
if (state.signedOut?.gh) fail('To get started with GitHub CLI, please run:  gh auth login');
const environment = state.github[at('--env')];
if (!environment) fail('HTTP 404: Not Found');
if (args[0] === 'secret' && args[1] === 'list' && at('--json') === 'name') {
	save();
	process.stdout.write(JSON.stringify(Object.keys(environment).map((name) => ({ name }))));
} else if (args[0] === 'secret' && args[1] === 'set' && args.length === 5) {
	environment[args[2]] = stdin();
	save();
} else fail('fake gh: unexpected ' + args.join(' '));
`;

function executable(path: string, body: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, `#!${process.execPath}\n${body}`);
	chmodSync(path, 0o755);
}

/**
 * A checkout of one app, `stream`, with the given descriptor, Wrangler config
 * and secrets map, and the fake tools: `op` and `gh` on `env.PATH`, which
 * holds nothing else, and the app's own `wrangler`.
 */
export function fakeCheckout({
	descriptor,
	wranglerConfig,
	secretsMap,
	state,
}: {
	descriptor: unknown;
	wranglerConfig: unknown;
	secretsMap: unknown;
	state: Omit<FakeState, 'argv'>;
}) {
	const root = mkdtempSync(join(tmpdir(), 'keepr-secrets-'));
	const write = (path: string, content: unknown) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), JSON.stringify(content));
	};
	write('pnpm-workspace.yaml', {});
	write('secrets.jsonc', secretsMap);
	write('apps/stream/package.json', { name: '@keepr/stream', version: '1.0.0' });
	write('apps/stream/deploy.jsonc', descriptor);
	write('apps/stream/wrangler.jsonc', wranglerConfig);
	write('state.json', { ...state, argv: [] });
	executable(join(root, 'bin/op'), OP);
	executable(join(root, 'bin/gh'), GH);
	executable(join(root, 'apps/stream/node_modules/.bin/wrangler'), WRANGLER);
	return {
		root,
		env: { PATH: join(root, 'bin'), FAKE_SECRETS_STATE: join(root, 'state.json') },
		state: (): FakeState => JSON.parse(readFileSync(join(root, 'state.json'), 'utf8')),
		remove: () => rmSync(root, { recursive: true, force: true }),
	};
}
