CREATE TABLE `invitationSecret` (
	`invitation_id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
-- A User held one membership of an Organisation only by convention: a second, if
-- any, goes before the index makes it one. The first joined stays (ADR-0155).
DELETE FROM `member` WHERE `rowid` NOT IN (SELECT min(`rowid`) FROM `member` GROUP BY `organization_id`, `user_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `member_organization_user_idx` ON `member` (`organization_id`,`user_id`);
--> statement-breakpoint
-- An Invitation open before its link carried a secret was answerable by its id
-- alone: each is cancelled, a row of the Audit Record naming no actor (ADR-0155).
INSERT INTO `auditRecord` (`id`, `at`, `actor_user_id`, `action`, `organization_id`, `subject_user_id`, `detail`)
SELECT lower(hex(randomblob(16))), CAST(strftime('%s', 'now') AS INTEGER) * 1000, NULL, 'invitation.cancelled', `organization_id`, NULL, json_object('invitationId', `id`, 'email', `email`, 'because', 'no-secret')
FROM `invitation` WHERE `status` = 'pending';
--> statement-breakpoint
UPDATE `invitation` SET `status` = 'canceled' WHERE `status` = 'pending';
