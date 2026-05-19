import { z } from "zod";

const envSchema = z.object({
  // WhatsApp Cloud API
  WHATSAPP_API_VERSION: z.string().default("v21.0"),
  WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  WHATSAPP_VERIFY_TOKEN: z.string().min(1),
  WHATSAPP_APP_SECRET: z.string().min(1),

  // Genie AI Backend
  GENIEAI_API_BASE_URL: z.string().url().default("https://app.youngailinz.org/api"),
  GENIEAI_API_TIMEOUT_MS: z.coerce.number().default(30_000),

  // STT/TTS Microservice
  STT_SERVICE_URL: z.string().url().optional().or(z.literal("")),
  STT_TIMEOUT_MS: z.coerce.number().default(15_000),
  TTS_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // Vital Data & Habit Tracker (future)
  VITALS_SERVICE_URL: z.string().url().optional().or(z.literal("")),
  VITALS_ENABLED: z
    .string()
    .transform((v) => v === "true")
    .default("false"),

  // Database
  DATABASE_URL: z.string().min(1),

  // Redis
  REDIS_URL: z.string().default("redis://localhost:6379"),

  // Internal API
  INTERNAL_API_KEY: z.string().min(1),

  // Server
  PORT: z.coerce.number().default(3002),
  HOST: z.string().default("0.0.0.0"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
});

export type Config = z.infer<typeof envSchema>;

let _config: Config | undefined;

export function loadConfig(): Config {
  if (_config) return _config;
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const formatted = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${formatted}`);
  }
  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) throw new Error("Config not loaded. Call loadConfig() first.");
  return _config;
}
