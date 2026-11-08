/** A thin client for the PrepUp REST API. Every call carries the signed-in user's token. */
import type { ReviewEventView, TopicView } from "@prepup/contracts";

export interface AppConfig {
  authMode: "supabase" | "dev";
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
}

/** Local development user, used only when the API runs with AUTH_MODE=dev. */
export const DEV_USER_ID = "11111111-1111-4111-8111-111111111111";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function loadConfig(): Promise<AppConfig> {
  const res = await fetch("/app-config");
  if (!res.ok) throw new ApiError(res.status, "Could not reach PrepUp");
  return res.json();
}

export type TokenSource = () => Promise<string | null>;

export function createApi(getToken: TokenSource, mode: AppConfig["authMode"]) {
  async function request<T>(path: string, init: { method?: string; body?: unknown } = {}) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (mode === "dev") headers["x-dev-user-id"] = DEV_USER_ID;
    else {
      const token = await getToken();
      if (token) headers.authorization = `Bearer ${token}`;
    }
    const res = await fetch(path, {
      method: init.method ?? "GET",
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, (data as { message?: string }).message ?? "Something went wrong");
    return { status: res.status, data: data as T };
  }
  const call = async <T>(path: string, init?: { method?: string; body?: unknown }) => (await request<T>(path, init)).data;

  return {
    listTopics: () => call<TopicView[]>("/api/topics?limit=500"),
    addTopic: async (term: string) => {
      const { status, data } = await request<TopicView>("/api/topics", { method: "POST", body: { term } });
      return { topic: data, created: status === 201 };
    },
    updateTopic: (id: string, body: { importance?: string; explanation?: string }) =>
      call<TopicView>(`/api/topics/${id}`, { method: "PATCH", body }),
    setScore: (id: string, score: number) => call<TopicView>(`/api/topics/${id}/score`, { method: "PUT", body: { score } }),
    history: (id: string) => call<ReviewEventView[]>(`/api/topics/${id}/history`),
  };
}

export type Api = ReturnType<typeof createApi>;
