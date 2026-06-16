CREATE TABLE `control_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`scope_kind` text DEFAULT 'workspace' NOT NULL,
	`scope_session_id` text,
	`auto_approved_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`scope_session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_control_conversations_updated` ON `control_conversations` (`updated_at`);--> statement-breakpoint
CREATE TABLE `control_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'complete' NOT NULL,
	`turn_id` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cost_usd` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `control_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_control_messages_conversation` ON `control_messages` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `control_tool_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`capability` text NOT NULL,
	`kind` text NOT NULL,
	`input_json` text NOT NULL,
	`result_json` text,
	`status` text DEFAULT 'running' NOT NULL,
	`confirmation` text,
	`affected_entity` text,
	`started_at` text NOT NULL,
	`finished_at` text,
	FOREIGN KEY (`conversation_id`) REFERENCES `control_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_control_tool_calls_conversation` ON `control_tool_calls` (`conversation_id`);--> statement-breakpoint
CREATE INDEX `idx_control_tool_calls_affected` ON `control_tool_calls` (`affected_entity`);