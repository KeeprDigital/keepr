CREATE TABLE `realtime_tickets` (
	`ticket_digest` text PRIMARY KEY NOT NULL,
	`event_id` integer NOT NULL,
	`screen_id` integer NOT NULL,
	`capability_digest` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`screen_id`) REFERENCES `screens`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `realtime_tickets_screen_id_idx` ON `realtime_tickets` (`screen_id`);--> statement-breakpoint
CREATE INDEX `realtime_tickets_expires_at_idx` ON `realtime_tickets` (`expires_at`);