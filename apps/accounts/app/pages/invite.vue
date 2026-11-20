<script setup lang="ts">
import { APP_REGISTRY, isAppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import {
	APP_ROLE_CHOICES,
	chosenAppRoles,
	noAppAccess,
	ORGANISATION_ROLE_CHOICES,
} from '~/utils/appRoleChoices';
import { readRefusal, refusalSentence } from '~/utils/refusal';
import { RECENT_SIGN_IN_REQUIRED } from '~~/shared/utils/recentSignIn';

/**
 * An Organisation's owners and admins, or a Keepr Administrator, invite an email
 * address to it, with an Organisation role and an App role per App from the App
 * registry: the Organisation worked in, or the one `?organisation=` names. The
 * Invitation is emailed, and its link goes to the invitee alone: it carries the
 * secret that accepts it (ADR-0155). Inviting needs a sign-in from the last ten
 * minutes. Below, the Organisation's pending Invitations, each to cancel;
 * inviting an address again replaces its earlier one.
 */

const form = reactive({ email: '', role: 'member', appRoles: noAppAccess() });
const submitting = ref(false);
const refusal = ref<string | null>(null);
/** The address the Invitation last made was emailed to. */
const emailedTo = ref<string | null>(null);
/** An Invitation the server refused for a sign-in more than ten minutes old. */
const signInAgain = ref(false);

interface PendingInvitation {
	id: string;
	email: string;
	role: string;
	appRoles: Record<string, string>;
	inviterName: string;
	expiresAt: string;
}

/** The Organisation's pending Invitations. */
const pending = ref<PendingInvitation[]>([]);
const cancelling = ref<string | null>(null);
const pendingRefusal = ref<string | null>(null);

// Closed to anyone who does not manage the Organisation's members.
const named = useRoute().query.organisation;
const organisationId = typeof named === 'string' && named.length > 0 ? named : undefined;
const { state, managed } = useManagedOrganisation({ organisationId });

const signInAgainLink = `/sign-in?returnTo=${encodeURIComponent(
	organisationId ? `/invite?organisation=${encodeURIComponent(organisationId)}` : '/invite',
)}`;

const invitationsPath = computed(
	() => `/api/organisations/${encodeURIComponent(managed.value!.organisation.id)}/invitations`,
);

async function loadPending() {
	try {
		pending.value = await $fetch<PendingInvitation[]>(invitationsPath.value);
	} catch {
		pending.value = [];
	}
}

watch(managed, async (now) => {
	if (now) await loadPending();
});

async function cancel(invitationId: string) {
	if (cancelling.value) return;
	cancelling.value = invitationId;
	pendingRefusal.value = null;
	try {
		await $fetch(`${invitationsPath.value}/${encodeURIComponent(invitationId)}`, {
			method: 'DELETE',
		});
	} catch (failure) {
		pendingRefusal.value = refusalSentence(failure, {
			serverMessage: true,
			otherwise: 'Cancelling that invitation failed. Try again.',
		});
	} finally {
		cancelling.value = null;
	}
	await loadPending();
}

function offered(invitation: PendingInvitation): string {
	const apps = Object.entries(invitation.appRoles).map(
		([app, role]) => `${isAppId(app) ? APP_REGISTRY[app].name : app}: ${role}`,
	);
	return [invitation.role, ...apps].join(' · ');
}

function lapses(invitation: PendingInvitation): string {
	return new Date(invitation.expiresAt).toLocaleDateString(undefined, { dateStyle: 'medium' });
}

async function invite() {
	if (submitting.value) return;
	submitting.value = true;
	refusal.value = null;
	emailedTo.value = null;
	signInAgain.value = false;
	const email = form.email.trim();
	try {
		await $fetch(invitationsPath.value, {
			method: 'POST',
			body: { email, role: form.role, appRoles: chosenAppRoles(form.appRoles) },
		});
		emailedTo.value = email;
	} catch (failure) {
		if (readRefusal(failure).code === RECENT_SIGN_IN_REQUIRED) signInAgain.value = true;
		else
			refusal.value = refusalSentence(failure, {
				codes: {
					OWNER_REQUIRED:
						'Only an owner can invite another owner, or invite again an address offered an owner’s role.',
					ALREADY_A_MEMBER: 'That address is already a member.',
					INVALID_EMAIL: 'Enter one email address.',
					TOO_MANY_INVITATIONS: 'You have sent a lot of invitations this hour. Try again later.',
				},
				otherwise: 'Inviting failed. Try again.',
			});
		return;
	} finally {
		submitting.value = false;
	}
	await loadPending();
}
</script>

<template>
	<div class="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
		<p v-if="state === 'closed'" data-closed class="text-muted">
			Only an owner or admin of an Organisation can invite people to it.
		</p>
		<p v-else-if="state === 'failed'" class="text-muted">
			This page could not be loaded. Reload to try again.
		</p>
		<UCard v-else-if="state === 'open' && managed" class="w-full max-w-md">
			<UForm :state="form" @submit="invite">
				<div class="flex flex-col gap-4">
					<h1 class="text-lg font-semibold">Invite someone</h1>
					<p data-organisation class="text-sm text-muted">To {{ managed.organisation.name }}</p>

					<UAlert
						v-if="signInAgain"
						data-sign-in-again
						color="warning"
						variant="subtle"
						description="Inviting needs a sign-in from the last ten minutes. Sign in again, then send the invitation."
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

					<UFormField name="email" label="Email address">
						<UInput
							v-model="form.email"
							type="email"
							autocomplete="off"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UFormField name="role" label="Organisation role">
						<USelect
							v-model="form.role"
							data-organisation-role
							:items="ORGANISATION_ROLE_CHOICES"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UFormField
						v-for="app in APP_ROLE_CHOICES"
						:key="app.app"
						:name="app.app"
						:label="app.name"
					>
						<USelect
							v-model="form.appRoles[app.app]"
							:data-app="app.app"
							:items="app.items"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UButton type="submit" color="primary" block :loading="submitting">
						Send invitation
					</UButton>

					<p v-if="emailedTo" data-invited class="text-sm">
						Invitation emailed to {{ emailedTo }}. Its link is theirs alone: if it does not arrive,
						check the address and invite them again.
					</p>
				</div>
			</UForm>
		</UCard>

		<UCard v-if="state === 'open' && pending.length > 0" data-pending class="w-full max-w-md">
			<div class="flex flex-col gap-4">
				<h2 class="text-lg font-semibold">Pending invitations</h2>
				<UAlert
					v-if="pendingRefusal"
					color="error"
					variant="subtle"
					:description="pendingRefusal"
				/>
				<ul class="flex flex-col divide-y divide-default">
					<li
						v-for="invitation in pending"
						:key="invitation.id"
						:data-pending-invitation="invitation.id"
						class="flex items-center justify-between gap-4 py-3"
					>
						<div class="min-w-0">
							<p class="truncate">{{ invitation.email }}</p>
							<p class="text-sm text-muted">{{ offered(invitation) }}</p>
							<p class="text-sm text-muted">
								Invited by {{ invitation.inviterName }} · open until {{ lapses(invitation) }}
							</p>
						</div>
						<UButton
							data-cancel
							color="neutral"
							variant="outline"
							:loading="cancelling === invitation.id"
							@click="cancel(invitation.id)"
						>
							Cancel
						</UButton>
					</li>
				</ul>
			</div>
		</UCard>
	</div>
</template>
