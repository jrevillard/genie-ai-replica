CREATE TABLE "campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_name" varchar(100) NOT NULL,
	"template_params" jsonb,
	"target_criteria" jsonb,
	"scheduled_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"total_recipients" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"delivered_count" integer DEFAULT 0 NOT NULL,
	"read_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feedback_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_user_id" uuid,
	"genieai_query_id" varchar(50),
	"rating" varchar(10) NOT NULL,
	"feedback_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_delivery_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"whatsapp_message_id" varchar(100) NOT NULL,
	"status" varchar(20) NOT NULL,
	"error_code" integer,
	"error_message" varchar(500),
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_user_id" uuid,
	"whatsapp_message_id" varchar(100),
	"direction" varchar(10) NOT NULL,
	"message_type" varchar(20) NOT NULL,
	"content_preview" varchar(500),
	"genieai_query_id" varchar(50),
	"template_name" varchar(100),
	"processing_time_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scheduled_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wa_user_id" uuid NOT NULL,
	"template_name" varchar(100) NOT NULL,
	"template_params" jsonb,
	"schedule_type" varchar(20) NOT NULL,
	"cron_expression" varchar(50),
	"next_run_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wa_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone_number" varchar(20) NOT NULL,
	"genieai_user_id" varchar(50) NOT NULL,
	"genieai_access_token" text NOT NULL,
	"genieai_refresh_token" text DEFAULT '' NOT NULL,
	"genieai_token_expires_at" timestamp with time zone NOT NULL,
	"active_conversation_id" varchar(50),
	"conversation_started_at" timestamp with time zone,
	"display_name" varchar(100),
	"risk_profile_json" jsonb,
	"preferred_nudge_time" time,
	"region" varchar(100),
	"opted_out" boolean DEFAULT false NOT NULL,
	"opted_out_at" timestamp with time zone,
	"last_message_at" timestamp with time zone,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wa_users_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
ALTER TABLE "feedback_log" ADD CONSTRAINT "feedback_log_wa_user_id_wa_users_id_fk" FOREIGN KEY ("wa_user_id") REFERENCES "public"."wa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_log" ADD CONSTRAINT "message_log_wa_user_id_wa_users_id_fk" FOREIGN KEY ("wa_user_id") REFERENCES "public"."wa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_messages" ADD CONSTRAINT "scheduled_messages_wa_user_id_wa_users_id_fk" FOREIGN KEY ("wa_user_id") REFERENCES "public"."wa_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_delivery_log_wa_msg_id" ON "message_delivery_log" USING btree ("whatsapp_message_id");--> statement-breakpoint
CREATE INDEX "idx_message_log_wa_user" ON "message_log" USING btree ("wa_user_id");--> statement-breakpoint
CREATE INDEX "idx_message_log_wa_msg_id" ON "message_log" USING btree ("whatsapp_message_id");--> statement-breakpoint
CREATE INDEX "idx_scheduled_next_run" ON "scheduled_messages" USING btree ("next_run_at");--> statement-breakpoint
CREATE INDEX "idx_wa_users_phone" ON "wa_users" USING btree ("phone_number");--> statement-breakpoint
CREATE INDEX "idx_wa_users_genieai_id" ON "wa_users" USING btree ("genieai_user_id");