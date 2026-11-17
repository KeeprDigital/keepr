/** How far the signed-in User manages an Organisation's members (`managingStanding`). */
export type ManagingStanding = 'owner' | 'admin' | 'keepr-administrator';

export interface ManagedOrganisation {
	organisation: { id: string; name: string };
	standing: ManagingStanding;
}

/**
 * The Organisation the signed-in User is working in, or `organisationId` when
 * named, when they manage its members: what opens the member and Invitation
 * screens. `closed` for anyone else, the server deciding; a signed-out visitor is
 * sent to sign in.
 */
export function useManagedOrganisation({
	organisationId: named,
}: { organisationId?: string } = {}) {
	const route = useRoute();
	const state = ref<'loading' | 'open' | 'closed' | 'failed'>('loading');
	const managed = ref<ManagedOrganisation | null>(null);

	onMounted(async () => {
		const signedIn = await $fetch<{ session: { activeOrganizationId?: string | null } } | null>(
			'/api/auth/get-session',
		);
		if (!signedIn)
			return await navigateTo(`/sign-in?returnTo=${encodeURIComponent(route.fullPath)}`);
		const organisationId = named || signedIn.session.activeOrganizationId;
		if (!organisationId) return (state.value = 'closed');
		try {
			managed.value = await $fetch<ManagedOrganisation>(
				`/api/organisations/${encodeURIComponent(organisationId)}/standing`,
			);
			state.value = 'open';
		} catch (failure) {
			state.value = (failure as { statusCode?: number }).statusCode === 403 ? 'closed' : 'failed';
		}
	});

	return { state, managed };
}
