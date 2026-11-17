<script setup lang="ts">
import type { AppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { APP_REGISTRY } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { invitationLink } from '~~/shared/utils/invitationLink';

/**
 * An Organisation owner or admin invites an email address to the Organisation
 * they are working in, with an Organisation role and an App role per App from the
 * App registry. The Invitation is emailed; its link is shown to copy as well, for
 * when the email does not arrive.
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

onMounted(async () => {
	if (!(await $fetch('/api/auth/get-session'))) await navigateTo('/sign-in');
});

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
	} finally {
		submitting.value = false;
	}
}

async function copy() {
	if (!link.value) return;
	await navigator.clipboard.writeText(link.value);
	copied.value = true;
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center p-4">
		<UCard class="w-full max-w-md">
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
	</div>
</template>
