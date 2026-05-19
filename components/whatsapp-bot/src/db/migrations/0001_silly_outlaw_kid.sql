ALTER TABLE "wa_users" ADD COLUMN "genieai_login_name" varchar(100) DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wa_users" ADD COLUMN "genieai_enc_password" text DEFAULT '' NOT NULL;