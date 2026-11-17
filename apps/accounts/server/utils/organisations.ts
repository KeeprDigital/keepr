import type { IdentityDatabase } from '~~/server/db';
import type { EmailSender } from '~~/server/email/sender';
import type { AppRoles } from './appAccess';
import { APIError } from 'better-auth/api';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { schema } from '~~/server/db';
import { invitationEmail } from '~~/server/email/messages';
import { invitationLink } from '~~/shared/utils/invitationLink';
import { grantAppAccess, offeredAppRoles } from './appAccess';
import { recordAudit } from './auditRecord';

/**
 * What Keepr Accounts adds to the organisation add-on (ADR-0114): App roles
 * offered on an Invitation are checked against the App registry, copied into App
 * access when it is accepted, and each step is in the Audit Record. The library
 * does neither (#1256).
 */

/** Where Keepr Accounts keeps what the library does not: App access and the Audit Record. */
export interface OrganisationRecords {
	organisationCreated: (created: {
		organizationId: string;
		name: string;
		actorUserId: string;
	}) => Promise<void>;
	invitationCreated: (created: {
		invitationId: string;
		organizationId: string;
		email: string;
		role: string;
		appRoles: AppRoles;
		inviterId: string;
	}) => Promise<void>;
	invitationCancelled: (cancelled: {
		invitationId: string;
		organizationId: string;
		email: string;
		cancelledBy: string;
	}) => Promise<void>;
	invitationDeclined: (declined: {
		invitationId: string;
		organizationId: string;
		email: string;
		/** The invitee's User, when the address has one. */
		userId: string | null;
	}) => Promise<void>;
	invitationAccepted: (accepted: {
		invitationId: string;
		organizationId: string;
		memberId: string;
		userId: string;
		role: string;
		appRoles: AppRoles;
	}) => Promise<void>;
}

export function organisationRecords(database: IdentityDatabase): OrganisationRecords {
	return {
		async organisationCreated({ organizationId, name, actorUserId }) {
			await recordAudit(database, {
				action: 'organisation.created',
				actorUserId,
				organizationId,
				detail: { name },
			});
		},
		async invitationCreated({ invitationId, organizationId, email, role, appRoles, inviterId }) {
			await recordAudit(database, {
				action: 'invitation.created',
				actorUserId: inviterId,
				organizationId,
				detail: { invitationId, email, role, appRoles },
			});
			// The library cancels the address's pending Invitation as it makes this one,
			// with no hook: the one it cancelled is the one with no cancellation recorded.
			for (const replaced of await unrecordedCancellations(database, organizationId, email))
				await recordAudit(database, {
					action: 'invitation.cancelled',
					actorUserId: inviterId,
					organizationId,
					detail: { invitationId: replaced, email, replacedBy: invitationId },
				});
		},
		async invitationCancelled({ invitationId, organizationId, email, cancelledBy }) {
			await recordAudit(database, {
				action: 'invitation.cancelled',
				actorUserId: cancelledBy,
				organizationId,
				detail: { invitationId, email },
			});
		},
		async invitationDeclined({ invitationId, organizationId, email, userId }) {
			await recordAudit(database, {
				action: 'invitation.declined',
				actorUserId: userId,
				organizationId,
				subjectUserId: userId,
				detail: { invitationId, email },
			});
		},
		async invitationAccepted({ invitationId, organizationId, memberId, userId, role, appRoles }) {
			await grantAppAccess(database, memberId, appRoles);
			await recordAudit(database, {
				action: 'invitation.accepted',
				actorUserId: userId,
				organizationId,
				subjectUserId: userId,
				detail: { invitationId, role, appRoles },
			});
		},
	};
}

/** The ids of `email`'s cancelled Invitations to `organizationId` the Audit Record has no cancellation of. */
async function unrecordedCancellations(
	database: IdentityDatabase,
	organizationId: string,
	email: string,
): Promise<string[]> {
	const recorded = database
		.select({ id: sql`json_extract(${schema.auditRecord.detail}, '$.invitationId')` })
		.from(schema.auditRecord)
		.where(
			and(
				eq(schema.auditRecord.action, 'invitation.cancelled'),
				eq(schema.auditRecord.organizationId, organizationId),
			),
		);
	const rows = await database
		.select({ id: schema.invitation.id })
		.from(schema.invitation)
		.where(
			and(
				eq(schema.invitation.organizationId, organizationId),
				eq(schema.invitation.email, email.toLowerCase()),
				eq(schema.invitation.status, 'canceled'),
				notInArray(schema.invitation.id, recorded),
			),
		);
	return rows.map(({ id }) => id);
}

/**
 * The organisation add-on's email and hooks, as Keepr Accounts sets them. The
 * Invitation email names its link from the request's own origin, and Keepr
 * Accounts' otherwise; the library sends it after answering, and a failed send
 * leaves the Invitation standing, its link still offered to copy.
 */
export function organisationOptions({
	email,
	records,
	fallbackOrigin,
}: {
	email: EmailSender;
	records: OrganisationRecords;
	fallbackOrigin: string;
}) {
	return {
		sendInvitationEmail: async (
			invitation: {
				id: string;
				email: string;
				organization: { name: string };
				inviter: { user: { name: string } };
			},
			request?: Request,
		) =>
			await email.send(
				invitationEmail({
					to: invitation.email,
					inviterName: invitation.inviter.user.name,
					organisationName: invitation.organization.name,
					link: invitationLink(
						request ? new URL(request.url).origin : fallbackOrigin,
						invitation.id,
					),
				}),
			),
		organizationHooks: {
			afterCreateOrganization: async ({
				organization,
				user,
			}: {
				organization: { id: string; name: string };
				user: { id: string };
			}) =>
				await records.organisationCreated({
					organizationId: organization.id,
					name: organization.name,
					actorUserId: user.id,
				}),
			// Stored as the registry-checked roles, so what is copied at acceptance is
			// what was checked here.
			beforeCreateInvitation: async ({ invitation }: { invitation: Record<string, unknown> }) => ({
				data: { appRoles: JSON.stringify(offeredAppRoles(invitation.appRoles)) },
			}),
			afterCreateInvitation: async ({
				invitation,
			}: {
				invitation: {
					id: string;
					organizationId: string;
					email: string;
					role: string;
					inviterId: string;
					appRoles?: unknown;
				};
			}) =>
				await records.invitationCreated({
					invitationId: invitation.id,
					organizationId: invitation.organizationId,
					email: invitation.email,
					role: invitation.role,
					appRoles: offeredAppRoles(invitation.appRoles),
					inviterId: invitation.inviterId,
				}),
			// The library would mark an accepted or declined Invitation cancelled too.
			beforeCancelInvitation: async ({ invitation }: { invitation: { status: string } }) => {
				if (invitation.status !== 'pending')
					throw APIError.from('BAD_REQUEST', {
						code: 'INVITATION_NOT_PENDING',
						message: 'Only a pending invitation can be cancelled.',
					});
			},
			afterCancelInvitation: async ({
				invitation,
				cancelledBy,
			}: {
				invitation: { id: string; organizationId: string; email: string };
				cancelledBy: { id: string };
			}) =>
				await records.invitationCancelled({
					invitationId: invitation.id,
					organizationId: invitation.organizationId,
					email: invitation.email,
					cancelledBy: cancelledBy.id,
				}),
			afterRejectInvitation: async ({
				invitation,
				user,
			}: {
				invitation: { id: string; organizationId: string; email: string };
				user: { id: string };
			}) =>
				await records.invitationDeclined({
					invitationId: invitation.id,
					organizationId: invitation.organizationId,
					email: invitation.email,
					userId: user.id,
				}),
			afterAcceptInvitation: async ({
				invitation,
				member,
				user,
			}: {
				invitation: { id: string; organizationId: string; role: string; appRoles?: unknown };
				member: { id: string };
				user: { id: string };
			}) =>
				await records.invitationAccepted({
					invitationId: invitation.id,
					organizationId: invitation.organizationId,
					memberId: member.id,
					userId: user.id,
					role: invitation.role,
					appRoles: offeredAppRoles(invitation.appRoles),
				}),
		},
	};
}
