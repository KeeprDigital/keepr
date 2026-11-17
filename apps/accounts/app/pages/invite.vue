<script setup lang="ts">
import type { AppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { APP_REGISTRY, isAppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { invitationLink } from '~~/shared/utils/invitationLink';

/**
 * An Organisation owner or admin invites an email address to the Organisation
 * they are working in, with an Organisation role and an App role per App from the
 * App registry. The Invitation is emailed; its link is shown to copy as well, for
 * when the email does not arrive. Below, the Organisation's pending Invitations,
 * each to cancel; inviting an address again replaces its earlier one.
 */

const NO_ACCESS = 'none';

const organisationRoles = [
	{ label: 'Member', value: 'member' },
	{ label: 'Admin', value: 'admin' },
	{ label: 'Owner', value: 'owner' },
];

const apps = (Object.keys(APP_REGISTRY) as AppId[]).map((app) => ({
	app,
	name: APP_REGISTRY[app].name,
	items: [
		{ label: 'No access', value: NO_ACCESS },
		...APP_REGISTRY[app].roles.map((role) => ({ label: role, value: role })),
	],
}));

const form = reactive({
	email: '',
	role: 'member',
	appRoles: Object.fromEntries(apps.map(({ app }) => [app, NO_ACCESS])) as Record<AppId, string>,
});
const submitting = ref(false);
const refusal = ref<string | null>(null);
/** The link to the Invitation last made, to copy. */
const link = ref<string | null>(null);
const copied = ref(false);

interface PendingInvitation {
	id: string;
	email: string;
	role: string;
	appRoles: Record<string, string>;
	inviterName: string;
	expiresAt: string;
}

/** The Organisation's pending Invitations; empty for whoever may not see them. */
const pending = ref<PendingInvitation[]>([]);
const cancelling = ref<string | null>(null);
const pendingRefusal = ref<string | null>(null);

async function loadPending() {
	try {
		pending.value = await $fetch<PendingInvitation[]>('/api/invitation/pending');
	} catch {
		pending.value = [];
	}
}

// Closed to anyone who does not manage the Organisation's members.
const { state } = useManagedOrganisation();

watch(state, async (now) => {
	if (now === 'open') await loadPending();
});

async function cancel(invitationId: string) {
	if (cancelling.value) return;
	cancelling.value = invitationId;
	pendingRefusal.value = null;
	try {
		await $fetch('/api/auth/organization/cancel-invitation', {
			method: 'POST',
			body: { invitationId },
		});
	} catch {
		pendingRefusal.value = 'Cancelling that invitation failed. Try again.';
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

function refusalOf(failure: { data?: { code?: string } }): string {
	switch (failure.data?.code) {
		case 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USER_WITH_THIS_ROLE':
			return 'Only an owner can invite another owner.';
		case 'YOU_ARE_NOT_ALLOWED_TO_INVITE_USERS_TO_THIS_ORGANIZATION':
			return 'Only an owner or admin of this organisation can invite.';
		case 'USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION':
			return 'That address is already a member.';
		case 'INVALID_EMAIL':
			return 'Enter an email address.';
	}
	return 'Inviting failed. Try again.';
}

async function invite() {
	if (submitting.value) return;
	submitting.value = true;
	refusal.value = null;
	link.value = null;
	copied.value = false;
	const appRoles = Object.fromEntries(
		Object.entries(form.appRoles).filter(([, role]) => role !== NO_ACCESS),
	);
	try {
		const { id } = await $fetch<{ id: string }>('/api/auth/organization/invite-member', {
			method: 'POST',
			body: { email: form.email, role: form.role, appRoles: JSON.stringify(appRoles) },
		});
		link.value = invitationLink(window.location.origin, id);
	} catch (failure) {
		refusal.value = refusalOf(failure as { data?: { code?: string } });
		return;
	} finally {
		submitting.value = false;
	}
	await loadPending();
}

async function copy() {
	if (!link.value) return;
	await navigator.clipboard.writeText(link.value);
	copied.value = true;
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
		<UCard v-else-if="state === 'open'" class="w-full max-w-md">
			<UForm :state="form" @submit="invite">
				<div class="flex flex-col gap-4">
					<h1 class="text-lg font-semibold">Invite someone</h1>

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
							:items="organisationRoles"
							class="w-full"
							:disabled="submitting"
						/>
					</UFormField>

					<UFormField v-for="app in apps" :key="app.app" :name="app.app" :label="app.name">
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

					<div v-if="link" data-invited class="flex flex-col gap-2">
						<p class="text-sm">
							Invitation sent. If the email does not arrive, send them this link instead:
						</p>
						<UInput :model-value="link" readonly data-link class="w-full" />
						<UButton color="neutral" variant="outline" block @click="copy">
							{{ copied ? 'Copied' : 'Copy link' }}
						</UButton>
					</div>
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
