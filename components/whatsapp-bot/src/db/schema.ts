import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
  jsonb,
  time,
  index,
} from "drizzle-orm/pg-core";

export const waUsers = pgTable(
  "wa_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    phoneNumber: varchar("phone_number", { length: 20 }).unique().notNull(),
    genieaiUserId: varchar("genieai_user_id", { length: 50 }).notNull(),
    genieaiLoginName: varchar("genieai_login_name", { length: 100 }).notNull().default(""),
    genieaiEncPassword: text("genieai_enc_password").notNull().default(""),
    genieaiAccessToken: text("genieai_access_token").notNull(),
    genieaiRefreshToken: text("genieai_refresh_token").notNull().default(""),
    genieaiTokenExpiresAt: timestamp("genieai_token_expires_at", { withTimezone: true }).notNull(),
    activeConversationId: varchar("active_conversation_id", { length: 50 }),
    conversationStartedAt: timestamp("conversation_started_at", { withTimezone: true }),
    displayName: varchar("display_name", { length: 100 }),
    riskProfileJson: jsonb("risk_profile_json"),
    preferredNudgeTime: time("preferred_nudge_time"),
    region: varchar("region", { length: 100 }),
    optedOut: boolean("opted_out").notNull().default(false),
    optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    messageCount: integer("message_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_wa_users_phone").on(table.phoneNumber),
    index("idx_wa_users_genieai_id").on(table.genieaiUserId),
  ],
);

export const messageLog = pgTable(
  "message_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    waUserId: uuid("wa_user_id").references(() => waUsers.id),
    whatsappMessageId: varchar("whatsapp_message_id", { length: 100 }),
    direction: varchar("direction", { length: 10 }).notNull(), // inbound | outbound
    messageType: varchar("message_type", { length: 20 }).notNull(),
    contentPreview: varchar("content_preview", { length: 500 }),
    genieaiQueryId: varchar("genieai_query_id", { length: 50 }),
    templateName: varchar("template_name", { length: 100 }),
    processingTimeMs: integer("processing_time_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_message_log_wa_user").on(table.waUserId),
    index("idx_message_log_wa_msg_id").on(table.whatsappMessageId),
  ],
);

export const messageDeliveryLog = pgTable(
  "message_delivery_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    whatsappMessageId: varchar("whatsapp_message_id", { length: 100 }).notNull(),
    status: varchar("status", { length: 20 }).notNull(),
    errorCode: integer("error_code"),
    errorMessage: varchar("error_message", { length: 500 }),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_delivery_log_wa_msg_id").on(table.whatsappMessageId),
  ],
);

export const feedbackLog = pgTable("feedback_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  waUserId: uuid("wa_user_id").references(() => waUsers.id),
  genieaiQueryId: varchar("genieai_query_id", { length: 50 }),
  rating: varchar("rating", { length: 10 }).notNull(), // up | down
  feedbackText: text("feedback_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const scheduledMessages = pgTable(
  "scheduled_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    waUserId: uuid("wa_user_id")
      .references(() => waUsers.id)
      .notNull(),
    templateName: varchar("template_name", { length: 100 }).notNull(),
    templateParams: jsonb("template_params"),
    scheduleType: varchar("schedule_type", { length: 20 }).notNull(), // one_time | recurring
    cronExpression: varchar("cron_expression", { length: 50 }),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_scheduled_next_run").on(table.nextRunAt),
  ],
);

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  templateName: varchar("template_name", { length: 100 }).notNull(),
  templateParams: jsonb("template_params"),
  targetCriteria: jsonb("target_criteria"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  status: varchar("status", { length: 20 }).notNull().default("pending"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  deliveredCount: integer("delivered_count").notNull().default(0),
  readCount: integer("read_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
