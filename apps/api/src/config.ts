import { DEFAULT_MAX_TOPICS, OAUTH_PROVIDERS } from "@prepup/contracts";
import { z } from "zod";

/** An empty value means "not set", since hosts often save a blank variable. Only https, as it becomes a link people click. */
const optionalHttpsUrl = z
  .string()
  .default("")
  .transform((s) => s.trim() || undefined)
  .pipe(z.url({ protocol: /^https$/, error: "must be an https:// URL" }).optional());

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
    // The `aud` claim a token must carry. Supabase gives signed-in users "authenticated".
    AUTH_AUDIENCE: z.string().min(1).default("authenticated"),
    // Per-user limits that protect a shared, free-tier host.
    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(120),
    RATE_LIMIT_PER_DAY: z.coerce.number().int().min(1).default(5000),
    MAX_TOPICS_PER_USER: z.coerce.number().int().min(1).max(500).default(DEFAULT_MAX_TOPICS),
    // What the public costs page shows. All optional: a private copy can leave them alone.
    HOSTING_COST_PER_MONTH: z.coerce.number().min(0).max(100000).default(0),
    DATABASE_LIMIT_MB: z.coerce.number().int().min(1).default(500),
    // A "support this" link (Buy Me a Coffee, GitHub Sponsors...). Empty hides it.
    SUPPORT_URL: optionalHttpsUrl,
    SOURCE_URL: z.url().default("https://github.com/Solivagant14/prepup"),
    // Comma-separated social sign-in buttons to show, e.g. "google,github". Empty = email only.
    AUTH_PROVIDERS: z
      .string()
      .default("")
      .transform((s) => [...new Set(s.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean))])
      .pipe(z.array(z.enum(OAUTH_PROVIDERS))),
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
