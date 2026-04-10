CREATE TABLE `session_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `metadata` text NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);

--> statement-breakpoint

CREATE INDEX `idx_session_runs_session_created` ON `session_runs` (`session_id`, `created_at`);
