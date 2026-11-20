DROP INDEX `archetypes_event_name_idx`;--> statement-breakpoint
-- Names an Event held twice in another case keep the first; each later one takes its id.
UPDATE `archetypes` SET `name` = `name` || ' (' || `id` || ')'
WHERE EXISTS (
	SELECT 1 FROM `archetypes` AS `earlier`
	WHERE `earlier`.`event_id` = `archetypes`.`event_id`
		AND lower(trim(`earlier`.`name`)) = lower(trim(`archetypes`.`name`))
		AND `earlier`.`id` < `archetypes`.`id`
);--> statement-breakpoint
CREATE UNIQUE INDEX `archetypes_event_name_key_idx` ON `archetypes` (`event_id`,lower(trim("name")));
