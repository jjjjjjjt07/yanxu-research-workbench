CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`project_id` text NOT NULL,
	`task` text NOT NULL,
	`model` text NOT NULL,
	`request_key` text NOT NULL,
	`output_key` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `export_manifests` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`project_id` text NOT NULL,
	`filename` text NOT NULL,
	`key` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`revision` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `graph_entities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graph_entities_project` ON `graph_entities` (`project_id`);--> statement-breakpoint
CREATE TABLE `graph_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graph_evidence_project` ON `graph_evidence` (`project_id`);--> statement-breakpoint
CREATE TABLE `graph_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`owner` text NOT NULL,
	`project_id` text NOT NULL,
	`paper_id` text NOT NULL,
	`task` text NOT NULL,
	`status` text NOT NULL,
	`stage` text NOT NULL,
	`snapshot` text NOT NULL,
	`result` text,
	`error` text,
	`error_kind` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`lease` text,
	`lease_until` text,
	`next_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graph_jobs_queue` ON `graph_jobs` (`status`,`next_at`);--> statement-breakpoint
CREATE INDEX `graph_jobs_project` ON `graph_jobs` (`project_id`,`owner`);--> statement-breakpoint
CREATE TABLE `graph_mentions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graph_mentions_project` ON `graph_mentions` (`project_id`);--> statement-breakpoint
CREATE TABLE `graph_relations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`data` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `graph_neighbors_source` ON `graph_relations` (`project_id`,`source`);--> statement-breakpoint
CREATE INDEX `graph_neighbors_target` ON `graph_relations` (`project_id`,`target`);--> statement-breakpoint
CREATE TABLE `graph_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner` text NOT NULL,
	`revision` integer NOT NULL,
	`data` text NOT NULL,
	`hash` text NOT NULL,
	`action` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `graph_revision_unique` ON `graph_revisions` (`project_id`,`revision`);--> statement-breakpoint
CREATE TABLE `graph_workers` (
	`id` text PRIMARY KEY NOT NULL,
	`heartbeat` text NOT NULL
);
