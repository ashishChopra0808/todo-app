CREATE TYPE "public"."group_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."invite_channel" AS ENUM('link', 'email', 'phone');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'hate', 'sexual', 'child_safety', 'violence', 'illegal', 'impersonation', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target" AS ENUM('task', 'comment', 'user', 'group');--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'moved';--> statement-breakpoint
ALTER TYPE "public"."activity_type" ADD VALUE 'commented';--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"author_id" uuid,
	"body" varchar(2000),
	"audio_file_id" uuid,
	"transcript" text,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"code" varchar(16) NOT NULL,
	"invited_by" uuid,
	"channel" "invite_channel" NOT NULL,
	"target_hash" varchar(64),
	"target_masked" varchar(64),
	"max_uses" integer NOT NULL,
	"use_count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_members_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(60) NOT NULL,
	"icon" varchar(16),
	"members_can_invite" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"purge_after" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid,
	"target_type" "report_target" NOT NULL,
	"target_id" uuid NOT NULL,
	"group_id" uuid,
	"owner_id" uuid,
	"reason" "report_reason" NOT NULL,
	"details" varchar(1000),
	"snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"action" varchar(20),
	"resolution_note" varchar(500),
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_audio_file_id_files_id_fk" FOREIGN KEY ("audio_file_id") REFERENCES "public"."files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invites" ADD CONSTRAINT "group_invites_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_task_idx" ON "comments" USING btree ("task_id","created_at") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "comments_author_idx" ON "comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX "comments_purge_idx" ON "comments" USING btree ("purge_after");--> statement-breakpoint
CREATE UNIQUE INDEX "group_invites_code_unique" ON "group_invites" USING btree ("code");--> statement-breakpoint
CREATE INDEX "group_invites_group_idx" ON "group_invites" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "groups_purge_idx" ON "groups" USING btree ("purge_after");--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "reports_target_idx" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reports_open_unique" ON "reports" USING btree ("reporter_id","target_type","target_id") WHERE status = 'open';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tasks_group_assignee_idx" ON "tasks" USING btree ("group_id","assignee_id","status") WHERE deleted_at IS NULL;