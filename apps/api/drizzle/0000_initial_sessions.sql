CREATE TABLE `sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text,
  `title` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  CHECK(`status` IN ('active', 'archived', 'deleted'))
);

--> statement-breakpoint

CREATE TABLE `session_messages` (
  `id` text PRIMARY KEY NOT NULL,
  `session_id` text NOT NULL,
  `role` text NOT NULL,
  `content` text NOT NULL,
  `status` text DEFAULT 'complete' NOT NULL,
  `sequence` integer NOT NULL,
  `token_count` integer,
  `metadata` text,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
  CHECK(`role` IN ('system', 'user', 'assistant', 'tool')),
  CHECK(`status` IN ('streaming', 'complete', 'error'))
);

--> statement-breakpoint

CREATE INDEX `idx_sessions_user_updated` ON `sessions` (`user_id`, `updated_at`);

--> statement-breakpoint

CREATE UNIQUE INDEX `idx_messages_session_sequence` ON `session_messages` (`session_id`, `sequence`);

--> statement-breakpoint

CREATE INDEX `idx_messages_session_created` ON `session_messages` (`session_id`, `created_at`);
