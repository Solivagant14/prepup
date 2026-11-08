import { z } from "zod";

const Config = z
  .object({
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().int().default(8080),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    PUBLIC_URL: z
      .url()
      .transform((u) => u.replace(/\/+$/, ""))
      .default("http://localhost:8080"),
    AUTH_MODE: z.enum(["supabase", "dev"]).default("supabase"),
    SUPABASE_URL: z
      .url()
      .transform((u) => u.replace(/\/+$/, ""))
      .optional(),
    SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    if (c.AUTH_MODE === "dev" && c.NODE_ENV === "production") {
      ctx.addIssue({ code: "custom", message: "AUTH_MODE=dev is refused in production" });
    }
    if (c.AUTH_MODE === "supabase" && !c.SUPABASE_URL) {
      ctx.addIssue({ code: "custom", message: "SUPABASE_URL is required when AUTH_MODE=supabase" });
    }
  });

export type Config = z.infer<typeof Config>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Config.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".") || "config"}: ${i.message}`);
    throw new Error(`Invalid configuration:\n${lines.join("\n")}`);
  }
  return parsed.data;
}
