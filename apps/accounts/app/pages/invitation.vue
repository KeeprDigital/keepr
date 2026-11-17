<script setup lang="ts">
import { APP_REGISTRY, isAppId } from '@keepr/nuxt-layer/shared/utils/appRegistry';
import { NEW_PASSWORD_REFUSALS, readRefusal, refusalSentence } from '~/utils/refusal';
import { MIN_PASSWORD_LENGTH } from '~~/shared/utils/newPassword';

/**
 * Where an Invitation's link lands. The invitee sees who invited them, to which
 * Organisation and with what, or why the Invitation is closed. They decline, or
 * accept: with no User, by choosing a name and a password; with one, signed in
 * with the invited address. The id is in the fragment, so no request line
 * carries it; the way to sign in and back is a navigation inside the page, so no
 * request line carries it either.
 */

interface Offer {
	email: string;
	organisationName: string;
	inviterName: string;
	role: string;
	appRoles: Record<string, string>;
	hasUser: boolean;
}

interface SignedIn {
	user: { email: string };
}

/** Why an Invitation is closed, as the server answers it. */
const CLOSED: Record<string, string> = {
	INVITATION_EXPIRED: 'This invitation has expired. Ask whoever invited you for a new one.',
	INVITATION_CANCELLED:
		'This invitation has been cancelled, or replaced by a newer one. Check your email for the latest, or ask whoever invited you.',
	INVITATION_ACCEPTED: 'This invitation has already been accepted. Sign in to use Keepr.',
	INVITATION_DECLINED: 'This invitation has been declined.',
};
const NOT_FOUND = 'There is no such invitation. Check the link, or ask whoever invited you.';

const invitationId = ref<string | null>();
/** The offer, `null` once the server said there is none open. */
const offer = ref<Offer | null>();
/** Why there is no offer, as the server's code. */
const closed = ref<string | null>(null);
/** Who is signed in, `null` once known that nobody is; read only for an address with a User. */
const signedIn = ref<SignedIn | null>();

onMounted(async () => {
	invitationId.value = new URLSearchParams(window.location.hash.slice(1)).get('id') || null;
	if (!invitationId.value) return;
	try {
		offer.value = await $fetch<Offer>('/api/invitation/offer', {
			method: 'POST',
			body: { invitationId: invitationId.value },
		});
	} catch (failure) {
		closed.value = readRefusal(failure).code ?? null;
		offer.value = null;
		return;
	}
	if (offer.value.hasUser)
		signedIn.value = (await $fetch<SignedIn | null>('/api/auth/get-session')) || null;
});

const closedReason = computed(() => (closed.value && CLOSED[closed.value]) || NOT_FOUND);

const apps = computed(() =>
	Object.entries(offer.value?.appRoles ?? {}).map(([app, role]) => ({
		app,
		name: isAppId(app) ? APP_REGISTRY[app].name : app,
		role,
	})),
);

/** Signs in and comes back here, the id still in the fragment. */
const signInLink = computed(
	() => `/sign-in?returnTo=${encodeURIComponent(`/invitation#id=${invitationId.value ?? ''}`)}`,
);
const signedInAsInvitee = computed(
	() =>
		!!signedIn.value &&
		!!offer.value &&
		signedIn.value.user.email.toLowerCase() === offer.value.email.toLowerCase(),
);

const form = reactive({ name: '', password: '', confirmation: '' });
const submitting = ref(false);
const refusal = ref<string | null>(null);
const declined = ref(false);

const mismatched = computed(
	() => form.confirmation.length > 0 && form.password !== form.confirmation,
);

const ANSWER_REFUSALS = {
	...NEW_PASSWORD_REFUSALS,
	codes: {
		...NEW_PASSWORD_REFUSALS.codes,
		...CLOSED,
		INVITATION_NOT_FOUND:
			'This invitation is no longer open. Ask whoever invited you for a new one.',
		USER_ALREADY_EXISTS: 'This address already has a Keepr account. Sign in to accept.',
		YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION:
			'This invitation is for another address. Sign in with that address to accept.',
		NAME_REQUIRED: 'Enter your name.',
	},
	otherwise: 'That did not work. Try again.',
};

/** Sends one answer at a time, and says why it was refused. */
async function answer(send: () => Promise<unknown>): Promise<boolean> {
	if (submitting.value || !invitationId.value) return false;
	submitting.value = true;
	refusal.value = null;
	try {
		await send();
		return true;
	} catch (failure) {
		refusal.value = refusalSentence(failure, ANSWER_REFUSALS);
		return false;
	} finally {
		submitting.value = false;
	}
}

async function acceptAsNewUser() {
	if (mismatched.value) return;
	const accepted = await answer(
		async () =>
			await $fetch('/api/invitation/accept', {
				method: 'POST',
				body: { invitationId: invitationId.value, name: form.name, password: form.password },
			}),
	);
	if (accepted) await navigateTo('/');
}

async function acceptSignedIn() {
	const accepted = await answer(
		async () =>
			await $fetch('/api/auth/organization/accept-invitation', {
				method: 'POST',
				body: { invitationId: invitationId.value },
			}),
	);
	if (accepted) await navigateTo('/');
}

async function decline() {
	declined.value = await answer(
		async () =>
			await $fetch('/api/invitation/decline', {
				method: 'POST',
				body: { invitationId: invitationId.value },
			}),
	);
}

async function signOut() {
	await answer(async () => await $fetch('/api/auth/sign-out', { method: 'POST', body: {} }));
	signedIn.value = null;
}
</script>

<template>
	<div class="flex min-h-screen items-center justify-center p-4">
		<UCard class="w-full max-w-sm">
			<div
				v-if="invitationId === null || offer === null"
				data-no-offer
				:data-closed="closed ?? undefined"
				class="flex flex-col gap-4"
			>
				<h1 class="text-lg font-semibold">This invitation is not open</h1>
				<p class="text-sm text-muted">{{ closedReason }}</p>
			</div>

			<div v-else-if="declined" data-declined class="flex flex-col gap-4">
				<h1 class="text-lg font-semibold">Invitation declined</h1>
				<p class="text-sm text-muted">
					You will not join {{ offer?.organisationName }}. If that was a mistake, ask whoever
					invited you for a new invitation.
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

				<UAlert
					v-if="refusal"
					data-refusal
					color="error"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					:description="refusal"
				/>

				<template v-if="offer.hasUser">
					<div v-if="signedIn === null" data-has-user class="flex flex-col gap-4">
						<p class="text-sm">
							This address already has a Keepr account. Sign in with it to accept.
						</p>
						<UButton data-sign-in :to="signInLink" color="primary" block>Sign in</UButton>
					</div>

					<UButton
						v-else-if="signedInAsInvitee"
						data-accept
						color="primary"
						block
						:loading="submitting"
						@click="acceptSignedIn"
					>
						Accept and join
					</UButton>

					<div v-else-if="signedIn" data-other-user class="flex flex-col gap-4">
						<p class="text-sm">
							You are signed in as {{ signedIn.user.email }}, but this invitation is for
							{{ offer.email }}. Sign out, then sign in with that address to accept.
						</p>
						<UButton color="neutral" variant="outline" block @click="signOut">Sign out</UButton>
					</div>
				</template>

				<UForm v-else :state="form" @submit="acceptAsNewUser">
					<div class="flex flex-col gap-4">
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

				<UButton
					data-decline
					color="neutral"
					variant="ghost"
					block
					:disabled="submitting"
					@click="decline"
				>
					Decline
				</UButton>
			</div>
		</UCard>
	</div>
</template>
