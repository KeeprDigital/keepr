<script setup lang="ts">
import type { AuthFailure } from '~~/shared/utils/newPassword';
import { APP_REGISTRY, isAppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { MIN_PASSWORD_LENGTH, newPasswordRefusal } from '~~/shared/utils/newPassword';

/**
 * Where an Invitation's link lands. The invitee sees who invited them, to which
 * Organisation and with what, then accepts by choosing a name and a password. The
 * id is in the fragment, so no request line carries it.
 */

interface Offer {
	email: string;
	organisationName: string;
	inviterName: string;
	role: string;
	appRoles: Record<string, string>;
	hasUser: boolean;
}

const invitationId = ref<string | null>();
/** The offer, `null` once the server said there is none open. */
const offer = ref<Offer | null>();

onMounted(async () => {
	invitationId.value = new URLSearchParams(window.location.hash.slice(1)).get('id') || null;
	if (!invitationId.value) return;
	try {
		offer.value = await $fetch<Offer>('/api/invitation/offer', {
			method: 'POST',
			body: { invitationId: invitationId.value },
		});
	} catch {
		offer.value = null;
	}
});

const apps = computed(() =>
	Object.entries(offer.value?.appRoles ?? {}).map(([app, role]) => ({
		app,
		name: isAppId(app) ? APP_REGISTRY[app].name : app,
		role,
	})),
);

const form = reactive({ name: '', password: '', confirmation: '' });
const submitting = ref(false);
const refusal = ref<string | null>(null);

const mismatched = computed(
	() => form.confirmation.length > 0 && form.password !== form.confirmation,
);

function refusalOf(failure: AuthFailure): string {
	switch (failure.data?.code) {
		case 'INVITATION_NOT_FOUND':
			return 'This invitation is no longer open. Ask whoever invited you for a new one.';
		case 'USER_ALREADY_EXISTS':
			return 'This address already has a Keepr account. Sign in to accept.';
		case 'NAME_REQUIRED':
			return 'Enter your name.';
	}
	return newPasswordRefusal(failure) ?? 'Accepting failed. Try again.';
}

async function accept() {
	if (submitting.value || !invitationId.value || mismatched.value) return;
	submitting.value = true;
	refusal.value = null;
	try {
		await $fetch('/api/invitation/accept', {
			method: 'POST',
			body: { invitationId: invitationId.value, name: form.name, password: form.password },
		});
	} catch (failure) {
		refusal.value = refusalOf(failure as AuthFailure);
		return;
	} finally {
		submitting.value = false;
	}
	await navigateTo('/');
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center p-4">
		<UCard class="w-full max-w-sm">
			<div v-if="invitationId === null || offer === null" data-no-offer class="flex flex-col gap-4">
				<h1 class="text-lg font-semibold">This invitation is not open</h1>
				<p class="text-sm text-muted">
					It may have expired, been cancelled or been accepted already. Ask whoever invited you for
					a new one.
				</p>
			</div>

			<div v-else-if="offer" class="flex flex-col gap-4">
				<div data-offer class="flex flex-col gap-2">
					<h1 class="text-lg font-semibold">Join {{ offer.organisationName }}</h1>
					<p class="text-sm text-muted">
						{{ offer.inviterName }} has invited {{ offer.email }} to {{ offer.organisationName }} on
						Keepr, as {{ offer.role }}.
					</p>
					<ul v-if="apps.length > 0" class="text-sm">
						<li v-for="app in apps" :key="app.app" :data-app="app.app">
							{{ app.name }}: {{ app.role }}
						</li>
					</ul>
				</div>

				<div v-if="offer.hasUser" data-has-user class="flex flex-col gap-4">
					<p class="text-sm">This address already has a Keepr account. Sign in to accept.</p>
					<UButton to="/sign-in" color="primary" block>Sign in</UButton>
				</div>

				<UForm v-else :state="form" @submit="accept">
					<div class="flex flex-col gap-4">
						<UAlert
							v-if="refusal"
							data-refusal
							color="error"
							variant="subtle"
							icon="i-lucide-triangle-alert"
							:description="refusal"
						/>

						<UFormField name="name" label="Your name">
							<UInput
								v-model="form.name"
								autocomplete="name"
								class="w-full"
								:disabled="submitting"
							/>
						</UFormField>

						<UFormField
							name="password"
							label="Password"
							:help="`At least ${MIN_PASSWORD_LENGTH} characters.`"
						>
							<UInput
								v-model="form.password"
								type="password"
								autocomplete="new-password"
								class="w-full"
								:disabled="submitting"
							/>
						</UFormField>

						<UFormField
							name="confirmation"
							label="Confirm password"
							:error="mismatched ? 'The two passwords do not match.' : undefined"
						>
							<UInput
								v-model="form.confirmation"
								type="password"
								autocomplete="new-password"
								class="w-full"
								:disabled="submitting"
							/>
						</UFormField>

						<UButton
							type="submit"
							color="primary"
							block
							:loading="submitting"
							:disabled="form.password.length === 0 || mismatched"
						>
							Accept and join
						</UButton>
					</div>
				</UForm>
			</div>
		</UCard>
	</div>
</template>
