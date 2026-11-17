<script setup lang="ts">
import type { AuthFailure } from '~~/shared/utils/newPassword';
import { APP_REGISTRY, isAppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { MIN_PASSWORD_LENGTH, newPasswordRefusal } from '~~/shared/utils/newPassword';

/**
 * The profile: who is signed in, their Organisations and the Apps they can use in
 * each, the one they work in, their name, their password and their Sessions.
 */

interface SignedIn {
	/** `role` is the admin add-on's: `admin` among it marks a Keepr Administrator. */
	user: { name: string; email: string; role?: string | null };
	session: { token: string };
}

interface ActiveSession {
	token: string;
	userAgent?: string | null;
	ipAddress?: string | null;
	updatedAt: string;
}

/** Who is signed in here, or `null` once known that nobody is. */
const signedIn = ref<SignedIn | null>();
const sessions = ref<ActiveSession[]>([]);

async function loadSignedIn() {
	signedIn.value = await $fetch<SignedIn | null>('/api/auth/get-session');
	if (signedIn.value) nameForm.name = signedIn.value.user.name;
}

async function loadSessions() {
	const listed = await $fetch<ActiveSession[]>('/api/auth/list-sessions');
	const current = signedIn.value?.session.token;
	// This browser first, then the most recently used.
	sessions.value = listed.toSorted(
		(a, b) =>
			Number(b.token === current) - Number(a.token === current) ||
			Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
	);
}

onMounted(async () => {
	await loadSignedIn();
	if (!signedIn.value) return await navigateTo('/sign-in');
	await Promise.all([loadSessions(), loadOrganisations()]);
});

// The Organisations, and the one worked in.
interface ProfileOrganisation {
	id: string;
	name: string;
	role: string;
	apps: Record<string, string>;
}

interface ProfileOrganisations {
	active: string | null;
	organisations: ProfileOrganisation[];
}

const organisations = ref<ProfileOrganisations>({ active: null, organisations: [] });
const switching = ref(false);
const organisationsRefusal = ref<string | null>(null);

async function loadOrganisations() {
	organisations.value = await $fetch<ProfileOrganisations>('/api/profile/organisations');
}

const switchable = computed(() =>
	organisations.value.organisations.map(({ id, name }) => ({ label: name, value: id })),
);

/** Whether the User manages an Organisation's members, which opens its member screen. */
function manages(organisation: ProfileOrganisation): boolean {
	return organisation.role === 'owner' || organisation.role === 'admin';
}

const keeprAdministrator = computed(
	() => signedIn.value?.user.role?.split(',').includes('admin') ?? false,
);

/** The App roles a User holds in an Organisation, by the App registry's names. */
function appsIn(organisation: ProfileOrganisation) {
	return Object.entries(organisation.apps).map(([app, role]) => ({
		app,
		name: isAppId(app) ? APP_REGISTRY[app].name : app,
		role,
	}));
}

async function workIn(organizationId: string) {
	if (switching.value || organizationId === organisations.value.active) return;
	switching.value = true;
	organisationsRefusal.value = null;
	try {
		// Carried on the Session, so every App's next Identity Proof names it.
		await $fetch('/api/auth/organization/set-active', {
			method: 'POST',
			body: { organizationId },
		});
	} catch {
		organisationsRefusal.value = 'Switching organisation failed. Try again.';
	} finally {
		switching.value = false;
	}
	await loadOrganisations();
}

// The name.
const nameForm = reactive({ name: '' });
const name = reactive({ saving: false, saved: false, refusal: null as string | null });

async function saveName() {
	if (name.saving) return;
	Object.assign(name, { saving: true, saved: false, refusal: null });
	try {
		await $fetch('/api/auth/update-user', { method: 'POST', body: { name: nameForm.name } });
		name.saved = true;
		await loadSignedIn();
	} catch {
		name.refusal = 'Saving your name failed. Try again.';
	} finally {
		name.saving = false;
	}
}

// The password.
const passwordForm = reactive({ current: '', next: '', confirmation: '' });
const password = reactive({ saving: false, saved: false, refusal: null as string | null });
const mismatched = computed(
	() => passwordForm.confirmation.length > 0 && passwordForm.next !== passwordForm.confirmation,
);

function passwordRefusalOf(failure: AuthFailure): string {
	if (failure.data?.code === 'INVALID_PASSWORD') return 'Your current password is not right.';
	return newPasswordRefusal(failure) ?? 'Changing your password failed. Try again.';
}

async function changePassword() {
	if (password.saving || mismatched.value) return;
	Object.assign(password, { saving: true, saved: false, refusal: null });
	try {
		await $fetch('/api/auth/change-password', {
			method: 'POST',
			body: {
				currentPassword: passwordForm.current,
				newPassword: passwordForm.next,
				// Whoever knew the old password is signed out with it.
				revokeOtherSessions: true,
			},
		});
		Object.assign(passwordForm, { current: '', next: '', confirmation: '' });
		password.saved = true;
		await loadSignedIn();
		await loadSessions();
	} catch (failure) {
		password.refusal = passwordRefusalOf(failure as AuthFailure);
	} finally {
		password.saving = false;
	}
}

// The Sessions.
const ending = ref<string | null>(null);
const sessionsRefusal = ref<string | null>(null);

async function endSession(token: string) {
	if (ending.value) return;
	ending.value = token;
	sessionsRefusal.value = null;
	try {
		await $fetch('/api/auth/revoke-session', { method: 'POST', body: { token } });
		await loadSessions();
	} catch {
		sessionsRefusal.value = 'Ending that Session failed. Try again.';
	} finally {
		ending.value = null;
	}
}

function lastUsed(session: ActiveSession): string {
	return new Date(session.updatedAt).toLocaleString(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short',
	});
}

// Signing out.
const signingOut = ref(false);

async function signOut() {
	signingOut.value = true;
	try {
		await $fetch('/api/auth/sign-out', { method: 'POST', body: {} });
	} finally {
		signingOut.value = false;
	}
	await navigateTo('/sign-in');
}
</script>

<template>
	<UContainer class="flex min-h-screen max-w-2xl flex-col gap-8 py-16">
		<h1 class="text-3xl font-semibold text-highlighted">Keepr Accounts</h1>

		<template v-if="signedIn">
			<div data-signed-in class="flex flex-wrap items-center justify-between gap-4">
				<p>
					Signed in as <strong>{{ signedIn.user.name }}</strong>
					<span class="text-muted">({{ signedIn.user.email }})</span>
				</p>
				<UButton
					data-sign-out
					color="neutral"
					variant="outline"
					:loading="signingOut"
					@click="signOut"
				>
					Sign out
				</UButton>
			</div>

			<UCard data-profile="organisations">
				<div class="flex flex-col gap-4">
					<h2 class="text-lg font-semibold">Your organisations</h2>
					<UAlert
						v-if="organisationsRefusal"
						color="error"
						variant="subtle"
						:description="organisationsRefusal"
					/>
					<p v-if="organisations.organisations.length === 0" class="text-sm text-muted">
						You do not belong to an organisation yet.
					</p>
					<UFormField
						v-if="organisations.organisations.length > 1"
						name="active"
						label="Working in"
						help="The organisation every Keepr App works in for you."
					>
						<USelect
							data-organisation-switcher
							:model-value="organisations.active ?? undefined"
							:items="switchable"
							class="w-full"
							:disabled="switching"
							@update:model-value="workIn($event as string)"
						/>
					</UFormField>
					<ul class="flex flex-col divide-y divide-default">
						<li
							v-for="organisation in organisations.organisations"
							:key="organisation.id"
							:data-organisation="organisation.id"
							:data-active="String(organisation.id === organisations.active)"
							class="flex flex-col gap-1 py-3"
						>
							<p>
								<strong>{{ organisation.name }}</strong>
								<span class="text-muted"> · {{ organisation.role }}</span>
							</p>
							<ul v-if="appsIn(organisation).length > 0" class="text-sm text-muted">
								<li v-for="app in appsIn(organisation)" :key="app.app" :data-app="app.app">
									{{ app.name }}: {{ app.role }}
								</li>
							</ul>
							<p v-else class="text-sm text-muted">No access to any App.</p>
							<div v-if="manages(organisation)" class="flex flex-wrap gap-2 pt-1">
								<UButton
									data-manage
									color="neutral"
									variant="outline"
									size="sm"
									:to="`/members?organisation=${encodeURIComponent(organisation.id)}`"
								>
									Members
								</UButton>
								<!-- An Invitation is to the Organisation worked in. -->
								<UButton
									v-if="organisation.id === organisations.active"
									data-manage
									color="neutral"
									variant="outline"
									size="sm"
									to="/invite"
								>
									Invite someone
								</UButton>
							</div>
						</li>
					</ul>
				</div>
			</UCard>

			<UCard v-if="keeprAdministrator" data-profile="platform">
				<div class="flex flex-wrap items-center justify-between gap-4">
					<div>
						<h2 class="text-lg font-semibold">Platform</h2>
						<p class="text-sm text-muted">
							You are a Keepr Administrator: every organisation, every user, and the audit record.
						</p>
					</div>
					<UButton data-manage color="neutral" variant="outline" to="/platform">
						Open the platform screen
					</UButton>
				</div>
			</UCard>

			<UCard data-profile="name">
				<UForm :state="nameForm" @submit="saveName">
					<div class="flex flex-col gap-4">
						<h2 class="text-lg font-semibold">Your name</h2>
						<p class="text-sm text-muted">How you are shown to others in every Keepr App.</p>
						<UAlert
							v-if="name.refusal"
							color="error"
							variant="subtle"
							:description="name.refusal"
						/>
						<UFormField name="name" label="Name">
							<UInput
								v-model="nameForm.name"
								autocomplete="name"
								class="w-full"
								:disabled="name.saving"
							/>
						</UFormField>
						<div class="flex items-center gap-3">
							<UButton
								type="submit"
								color="primary"
								:loading="name.saving"
								:disabled="nameForm.name.trim().length === 0"
							>
								Save name
							</UButton>
							<span v-if="name.saved" data-saved class="text-sm text-muted">Saved.</span>
						</div>
					</div>
				</UForm>
			</UCard>

			<UCard data-profile="password">
				<UForm :state="passwordForm" @submit="changePassword">
					<div class="flex flex-col gap-4">
						<h2 class="text-lg font-semibold">Your password</h2>
						<UAlert
							v-if="password.refusal"
							data-refusal
							color="error"
							variant="subtle"
							:description="password.refusal"
						/>
						<UFormField name="current" label="Current password">
							<UInput
								v-model="passwordForm.current"
								type="password"
								autocomplete="current-password"
								class="w-full"
								:disabled="password.saving"
							/>
						</UFormField>
						<UFormField
							name="next"
							label="New password"
							:help="`At least ${MIN_PASSWORD_LENGTH} characters.`"
						>
							<UInput
								v-model="passwordForm.next"
								type="password"
								autocomplete="new-password"
								class="w-full"
								:disabled="password.saving"
							/>
						</UFormField>
						<UFormField
							name="confirmation"
							label="Confirm new password"
							:error="mismatched ? 'The two passwords do not match.' : undefined"
						>
							<UInput
								v-model="passwordForm.confirmation"
								type="password"
								autocomplete="new-password"
								class="w-full"
								:disabled="password.saving"
							/>
						</UFormField>
						<div class="flex items-center gap-3">
							<UButton
								type="submit"
								color="primary"
								:loading="password.saving"
								:disabled="!passwordForm.current || !passwordForm.next || mismatched"
							>
								Change password
							</UButton>
							<span v-if="password.saved" data-saved class="text-sm text-muted">
								Password changed. You have been signed out everywhere else.
							</span>
						</div>
					</div>
				</UForm>
			</UCard>

			<UCard data-profile="sessions">
				<div class="flex flex-col gap-4">
					<h2 class="text-lg font-semibold">Where you are signed in</h2>
					<UAlert
						v-if="sessionsRefusal"
						color="error"
						variant="subtle"
						:description="sessionsRefusal"
					/>
					<ul class="flex flex-col divide-y divide-default">
						<li
							v-for="session in sessions"
							:key="session.token"
							data-session
							:data-current="String(session.token === signedIn.session.token)"
							class="flex items-center justify-between gap-4 py-3"
						>
							<div class="min-w-0">
								<p class="truncate">{{ session.userAgent || 'An unknown browser' }}</p>
								<p class="text-sm text-muted">
									<template v-if="session.token === signedIn.session.token">
										This browser
									</template>
									<template v-else>Last used {{ lastUsed(session) }}</template>
									<template v-if="session.ipAddress"> · {{ session.ipAddress }}</template>
								</p>
							</div>
							<UButton
								v-if="session.token !== signedIn.session.token"
								color="neutral"
								variant="outline"
								:loading="ending === session.token"
								@click="endSession(session.token)"
							>
								Sign out
							</UButton>
						</li>
					</ul>
				</div>
			</UCard>
		</template>
	</UContainer>
</template>
