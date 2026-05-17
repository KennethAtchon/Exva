CREATE TABLE `research_posture_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`preset_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `risk_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`preset_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `timeframe_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`preset_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `trade_rule_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`is_built_in` integer DEFAULT false NOT NULL,
	`preset_json` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `global_presets` ADD `is_built_in` integer DEFAULT false NOT NULL;