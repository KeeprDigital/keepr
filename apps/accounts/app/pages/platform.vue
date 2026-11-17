<script setup lang="ts">
import type { AppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { APP_REGISTRY } from '@keepr/nuxt-layer/shared/utils/appRegistry';

/**
 * The platform screen, a Keepr Administrator's: every Organisation, each opening
 * its members screen, and a new one created with its first owner invited; any
 * User found by name or email, and disabled or enabled again; and the Audit
 * Record. Closed to anyone else, the server deciding; every rule is the server's.
 */

interface ListedOrganisation {
	id: string;
	name: string;
	createdAt: string;
	members: number;
}

interface FoundUser {
	id: string;
	name: string;
	email: string;
	disabled: boolean;
	keeprAdministrator: boolean;
}

interface Named {
	id: string;
	name: string;
	email?: string;
}

interface AuditRow {
	id: string;
	at: string;
	action: string;
	actor: Named | null;
	subject: Named | null;
	organisation: Named | null;
	detail: Record<string, unknown> | null;
}

interface Refused {
	data?: { code?: string; message?: string };
	statusCode?: number;
}

const NO_ACCESS = 'none';

const apps = (Object.keys(APP_REGISTRY) as AppId[]).map((app) => ({
	app,
	name: APP_REGISTRY[app].name,
	items: [
		{ label: 'No access', value: NO_ACCESS },
		...APP_REGISTRY[app].roles.map((role) => ({ label: role, value: role })),
	],
}));

const state = ref<'loading' | 'open' | 'closed' | 'failed'>('loading');
const organisations = ref<ListedOrganisation[]>([]);
const auditRows = ref<AuditRow[]>([]);
/** A change the server refused for a sign-in more than ten minutes old. */
const signInAgain = ref(false);

async function loadOrganisations() {
	organisations.value = await $fetch<ListedOrganisation[]>('/api/platform/organisations');
}

async function loadAuditRecord() {
	auditRows.value = await $fetch<AuditRow[]>('/api/platform/audit-record');
}

onMounted(async () => {
	const signedIn = await $fetch<unknown>('/api/auth/get-session');
	if (!signedIn) return await navigateTo('/sign-in?returnTo=%2Fplatform');
	try {
		await loadOrganisations();
	} catch (failure) {
		state.value = (failure as Refused).statusCode === 403 ? 'closed' : 'failed';
		return;
	}
	state.value = 'open';
	await loadAuditRecord();
});

/** What a refused change says, unless it is a sign-in too old, which asks for a new one. */
function refusalOf(failure: unknown, fallback: string): string | null {
	const { data } = failure as Refused;
	if (data?.code === 'RECENT_SIGN_IN_REQUIRED') {
		signInAgain.value = true;
		return null;
	}
	return data?.message ?? fallback;
}

// A new Organisation, and its first owner.
const createForm = reactive({
	name: '',
	ownerEmail: '',
	appRoles: Object.fromEntries(apps.map(({ app }) => [app, NO_ACCESS])) as Record<AppId, string>,
});
const creating = ref(false);
const createRefusal = ref<string | null>(null);
/** The Invitation link of the Organisation last created, to copy. */
const createdLink = ref<string | null>(null);
const copied = ref(false);

async function create() {
	if (creating.value) return;
	creating.value = true;
	createRefusal.value = null;
	createdLink.value = null;
	copied.value = false;
	signInAgain.value = false;
	try {
		const { link } = await $fetch<{ link: string }>('/api/platform/organisations', {
			method: 'POST',
			body: {
				name: createForm.name,
				ownerEmail: createForm.ownerEmail,
				appRoles: Object.fromEntries(
					Object.entries(createForm.appRoles).filter(([, role]) => role !== NO_ACCESS),
				),
			},
		});
		createdLink.value = link;
		Object.assign(createForm, { name: '', ownerEmail: '' });
	} catch (failure) {
		createRefusal.value = refusalOf(failure, 'Creating the organisation failed. Try again.');
		return;
	} finally {
		creating.value = false;
	}
	await Promise.all([loadOrganisations(), loadAuditRecord()]);
}

async function copy() {
	if (!createdLink.value) return;
	await navigator.clipboard.writeText(createdLink.value);
	copied.value = true;
}

// Finding a User, and disabling or enabling them.
const usersForm = reactive({ query: '' });
const searched = ref<string | null>(null);
const users = ref<FoundUser[]>([]);
const changingUser = ref<string | null>(null);
const usersRefusal = ref<string | null>(null);

async function findUsers(query: string = usersForm.query) {
	searched.value = query;
	users.value = await $fetch<FoundUser[]>('/api/platform/users', {
		query: { q: searched.value },
	});
}

async function setDisabled(user: FoundUser, disabled: boolean) {
	if (changingUser.value) return;
	changingUser.value = user.id;
	usersRefusal.value = null;
	signInAgain.value = false;
	try {
		await $fetch(
			`/api/platform/users/${encodeURIComponent(user.id)}/${disabled ? 'disable' : 'enable'}`,
			{ method: 'POST' },
		);
	} catch (failure) {
		usersRefusal.value = refusalOf(failure, 'That change failed. Try again.');
	} finally {
		changingUser.value = null;
	}
	await Promise.all([findUsers(searched.value ?? ''), loadAuditRecord()]);
}

function shownAt(at: string): string {
	return new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
</script>

<template>
	<UContainer class="flex min-h-screen max-w-3xl flex-col gap-8 py-16">
		<h1 class="text-2xl font-semibold text-highlighted">Platform</h1>

		<p v-if="state === 'closed'" data-closed class="text-muted">
			Only a Keepr Administrator can use the platform screen.
		</p>
		<p v-else-if="state === 'failed'" class="text-muted">
			This page could not be loaded. Reload to try again.
		</p>

		<template v-else-if="state === 'open'">
			<UAlert
				v-if="signInAgain"
				data-sign-in-again
				color="warning"
				variant="subtle"
				description="This needs a sign-in from the last ten minutes. Sign in again, then try once more."
				:actions="[
					{ label: 'Sign in again', onClick: () => navigateTo('/sign-in?returnTo=%2Fplatform') },
				]"
			/>

			<UCard data-organisations>
				<div class="flex flex-col gap-4">
					<h2 class="text-lg font-semibold">Organisations</h2>
					<ul class="flex flex-col divide-y divide-default">
						<li
							v-for="organisation in organisations"
							:key="organisation.id"
							:data-organisation="organisation.id"
							class="flex items-center justify-between gap-4 py-3"
						>
							<p>
								<strong>{{ organisation.name }}</strong>
								<span class="text-muted">
									· {{ organisation.members }}
									{{ organisation.members === 1 ? 'member' : 'members' }}
								</span>
							</p>
							<UButton
								color="neutral"
								variant="outline"
								size="sm"
								:to="`/members?organisation=${encodeURIComponent(organisation.id)}`"
							>
								Members
							</UButton>
						</li>
					</ul>
				</div>
			</UCard>

			<UCard data-create>
				<UForm :state="createForm" @submit="create">
					<div class="flex flex-col gap-4">
						<h2 class="text-lg font-semibold">Create an organisation</h2>
						<p class="text-sm text-muted">
							Its first owner is invited by email. You do not become a member of it.
						</p>
						<UAlert
							v-if="createRefusal"
							data-refusal
							color="error"
							variant="subtle"
							icon="i-lucide-triangle-alert"
							:description="createRefusal"
						/>
						<UFormField name="name" label="Name">
							<UInput
								v-model="createForm.name"
								name="name"
								autocomplete="off"
								class="w-full"
								:disabled="creating"
							/>
						</UFormField>
						<UFormField name="ownerEmail" label="First owner’s email address">
							<UInput
								v-model="createForm.ownerEmail"
								name="ownerEmail"
								type="email"
								autocomplete="off"
								class="w-full"
								:disabled="creating"
							/>
						</UFormField>
						<UFormField v-for="app in apps" :key="app.app" :name="app.app" :label="app.name">
							<USelect
								v-model="createForm.appRoles[app.app]"
								:data-app="app.app"
								:items="app.items"
								class="w-full"
								:disabled="creating"
							/>
						</UFormField>
						<UButton type="submit" color="primary" :loading="creating"> Create and invite </UButton>
						<div v-if="createdLink" data-created class="flex flex-col gap-2">
							<p class="text-sm">
								Created, and the first owner invited. If the email does not arrive, send them this
								link instead:
							</p>
							<UInput :model-value="createdLink" readonly class="w-full" />
							<UButton color="neutral" variant="outline" block @click="copy">
								{{ copied ? 'Copied' : 'Copy link' }}
							</UButton>
						</div>
					</div>
				</UForm>
			</UCard>

			<UCard data-users>
				<div class="flex flex-col gap-4">
					<h2 class="text-lg font-semibold">Users</h2>
					<UForm :state="usersForm" @submit="findUsers()">
						<div class="flex items-end gap-2">
							<UFormField name="query" label="Name or email" class="flex-1">
								<UInput
									v-model="usersForm.query"
									name="query"
									type="search"
									autocomplete="off"
									class="w-full"
								/>
							</UFormField>
							<UButton type="submit" color="neutral" variant="outline">Find</UButton>
						</div>
					</UForm>
					<UAlert v-if="usersRefusal" color="error" variant="subtle" :description="usersRefusal" />
					<p v-if="searched !== null && users.length === 0" class="text-sm text-muted">
						Nobody matches.
					</p>
					<ul class="flex flex-col divide-y divide-default">
						<li
							v-for="user in users"
							:key="user.id"
							:data-user="user.id"
							:data-disabled="String(user.disabled)"
							class="flex items-center justify-between gap-4 py-3"
						>
							<div class="min-w-0">
								<p class="truncate">
									<strong>{{ user.name }}</strong>
									<span class="text-muted"> ({{ user.email }})</span>
								</p>
								<p class="text-sm text-muted">
									<template v-if="user.disabled">Disabled</template>
									<template v-else>Active</template>
									<template v-if="user.keeprAdministrator"> · Keepr Administrator</template>
								</p>
							</div>
							<UButton
								v-if="user.disabled"
								data-enable
								color="neutral"
								variant="outline"
								:loading="changingUser === user.id"
								@click="setDisabled(user, false)"
							>
								Enable
							</UButton>
							<UButton
								v-else
								data-disable
								color="error"
								variant="outline"
								:loading="changingUser === user.id"
								@click="setDisabled(user, true)"
							>
								Disable
							</UButton>
						</li>
					</ul>
				</div>
			</UCard>

			<UCard data-audit-record>
				<div class="flex flex-col gap-4">
					<h2 class="text-lg font-semibold">Audit record</h2>
					<p v-if="auditRows.length === 0" class="text-sm text-muted">Nothing recorded yet.</p>
					<ul class="flex flex-col divide-y divide-default">
						<li
							v-for="row in auditRows"
							:key="row.id"
							:data-audit-row="row.id"
							class="flex flex-col gap-1 py-3 text-sm"
						>
							<p>
								<code>{{ row.action }}</code>
								<span class="text-muted"> · {{ shownAt(row.at) }}</span>
							</p>
							<p class="text-muted">
								By {{ row.actor?.name ?? 'the command line' }}
								<template v-if="row.subject"> · to {{ row.subject.name }}</template>
								<template v-if="row.organisation"> · in {{ row.organisation.name }}</template>
							</p>
						</li>
					</ul>
				</div>
			</UCard>
		</template>
	</UContainer>
</template>
