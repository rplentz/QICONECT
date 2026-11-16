import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { z } from "zod";

dotenv.config({ path: fileURLToPath(new URL("../../../../.env", import.meta.url)) });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3333),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_PATH: z.string().default("data/qiconect.sqlite"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(720).default(72),
});

export const env = envSchema.parse(process.env);
