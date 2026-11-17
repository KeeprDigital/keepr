<script setup lang="ts">
import type { AppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { APP_ROLE_CHOICES, NO_ACCESS, ORGANISATION_ROLE_CHOICES } from '~/utils/appRoleChoices';
import { readRefusal, refusalSentence } from '~/utils/refusal';
import { RECENT_SIGN_IN_REQUIRED } from '~~/shared/utils/recentSignIn';

/**
 * An Organisation's owners and admins see its members, with their Organisation
 * role and App roles, and change them: App access by anyone who manages, the
 * Organisation role by an owner. Every rule is the server's; this page sends
 * each change and shows what it answers.
 */

interface Member {
	memberId: string;
	name: string;
	email: string;
	role: string;
	apps: Partial<Record<AppId, string>>;
}

// A Keepr Administrator, or a User managing more than one, names the Organisation.
const named = useRoute().query.organisation;
const organisationId = typeof named === 'string' && named.length > 0 ? named : undefined;
const { state, managed } = useManagedOrganisation({ organisationId });
const members = ref<Member[]>([]);
/** The member a change is being sent for. */
const changing = ref<string | null>(null);
/** The member whose removal is waiting to be confirmed. */
const confirmingRemoval = ref<string | null>(null);
const refusal = ref<string | null>(null);
const signInAgain = ref(false);

const membersPath = computed(
	() => `/api/organisations/${encodeURIComponent(managed.value!.organisation.id)}/members`,
);

async function loadMembers() {
	members.value = (await $fetch<{ members: Member[] }>(membersPath.value)).members;
}

watch(
	managed,
	async (now) => {
		if (now) await loadMembers();
	},
	{ immediate: true },
);

/** Sends one change for `memberId`, then shows the members as the server now holds them. */
async function change(memberId: string, send: (path: string) => Promise<unknown>) {
	if (changing.value) return;
	changing.value = memberId;
	refusal.value = null;
	signInAgain.value = false;
	try {
		await send(`${membersPath.value}/${encodeURIComponent(memberId)}`);
	} catch (failure) {
		if (readRefusal(failure).code === RECENT_SIGN_IN_REQUIRED) signInAgain.value = true;
		else
			refusal.value = refusalSentence(failure, {
				codes: {
					LAST_OWNER: 'An Organisation keeps at least one owner. Make someone else an owner first.',
					OWNER_REQUIRED: 'Only an owner can do that.',
				},
				serverMessage: true,
				otherwise: 'That change failed. Try again.',
			});
	} finally {
		confirmingRemoval.value = null;
		await loadMembers();
		changing.value = null;
	}
}

function setOrganisationRole(member: Member, role: string) {
	return change(
		member.memberId,
		async (path) => await $fetch(`${path}/role`, { method: 'PUT', body: { role } }),
	);
}

function setAppRole(member: Member, app: AppId, role: string) {
	return change(member.memberId, async (path) =>
		role === NO_ACCESS
			? await $fetch(`${path}/app-access/${app}`, { method: 'DELETE' })
			: await $fetch(`${path}/app-access/${app}`, { method: 'PUT', body: { role } }),
	);
}

function remove(member: Member) {
	return change(member.memberId, async (path) => await $fetch(path, { method: 'DELETE' }));
}

/** The Invitation screen for this Organisation. */
const inviteLink = computed(
	() => `/invite?organisation=${encodeURIComponent(managed.value!.organisation.id)}`,
);

const signInAgainLink = computed(
	() =>
		`/sign-in?returnTo=${encodeURIComponent(
			organisationId ? `/members?organisation=${encodeURIComponent(organisationId)}` : '/members',
		)}`,
);
</script>

<template>
	<UContainer class="flex min-h-screen max-w-3xl flex-col gap-6 py-16">
		<h1 class="text-2xl font-semibold text-highlighted">Members</h1>

		<p v-if="state === 'closed'" data-closed class="text-muted">
			Only an owner or admin of an Organisation can see and change its members.
		</p>
		<p v-else-if="state === 'failed'" class="text-muted">
			The members could not be loaded. Reload to try again.
		</p>

		<template v-else-if="state === 'open' && managed">
			<div class="flex items-center justify-between gap-4">
				<p class="text-muted">{{ managed.organisation.name }}</p>
				<UButton data-invite color="neutral" variant="outline" size="sm" :to="inviteLink">
					Invite
				</UButton>
			</div>

			<UAlert
				v-if="signInAgain"
				data-sign-in-again
				color="warning"
				variant="subtle"
				description="Changing access needs a sign-in from the last ten minutes. Sign in again, then make the change."
				:actions="[{ label: 'Sign in again', onClick: () => navigateTo(signInAgainLink) }]"
			/>
			<UAlert
				v-if="refusal"
				data-refusal
				color="error"
				variant="subtle"
				icon="i-lucide-triangle-alert"
				:description="refusal"
			/>

			<ul class="flex flex-col divide-y divide-default">
				<li
					v-for="member in members"
					:key="member.memberId"
					data-member
					:data-member-id="member.memberId"
					class="flex flex-col gap-3 py-4"
				>
					<div class="flex flex-wrap items-center justify-between gap-2">
						<p>
							<strong>{{ member.name }}</strong>
							<span class="text-muted"> ({{ member.email }})</span>
						</p>
						<div class="flex items-center gap-2">
							<template v-if="confirmingRemoval === member.memberId">
								<UButton
									data-confirm-removal
									color="error"
									size="sm"
									:loading="changing === member.memberId"
									@click="remove(member)"
								>
									Remove {{ member.name }}
								</UButton>
								<UButton
									color="neutral"
									variant="ghost"
									size="sm"
									@click="confirmingRemoval = null"
								>
									Keep
								</UButton>
							</template>
							<UButton
								v-else
								data-remove
								color="neutral"
								variant="outline"
								size="sm"
								:disabled="changing !== null"
								@click="confirmingRemoval = member.memberId"
							>
								Remove
							</UButton>
						</div>
					</div>

					<div class="grid gap-3 sm:grid-cols-3">
						<UFormField label="Organisation role">
							<USelect
								data-organisation-role
								:model-value="member.role"
								:items="ORGANISATION_ROLE_CHOICES"
								class="w-full"
								:disabled="changing !== null || managed.standing === 'admin'"
								@update:model-value="(role: string) => setOrganisationRole(member, role)"
							/>
						</UFormField>
						<UFormField v-for="app in APP_ROLE_CHOICES" :key="app.app" :label="app.name">
							<USelect
								:data-app="app.app"
								:model-value="member.apps[app.app] ?? NO_ACCESS"
								:items="app.items"
								class="w-full"
								:disabled="changing !== null"
								@update:model-value="(role: string) => setAppRole(member, app.app, role)"
							/>
						</UFormField>
					</div>
				</li>
			</ul>
		</template>
	</UContainer>
</template>
