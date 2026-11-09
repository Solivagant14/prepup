/** Loads the public config, handles sign-in, then shows the deck. */
import type { OAuthProvider } from "@prepup/contracts";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { Deck } from "./components/Deck.js";
import { SignIn } from "./components/SignIn.js";
import { createApi, loadConfig, type AppConfig } from "./lib/api.js";

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devApi = useMemo(() => createApi(async () => null, "dev"), []);

  useEffect(() => {
    loadConfig().then(setConfig, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="auth error">{error}</p>;
  if (!config) return null;
  if (config.authMode === "dev") return <Deck api={devApi} />;
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    return <p className="auth error">PrepUp isn't configured yet (missing Supabase settings).</p>;
  }
  return (
    <SupabaseApp
      url={config.supabaseUrl}
      publishableKey={config.supabasePublishableKey}
      providers={config.providers ?? []}
    />
  );
}

function SupabaseApp({ url, publishableKey, providers }: { url: string; publishableKey: string; providers: OAuthProvider[] }) {
  const supabase = useMemo<SupabaseClient>(() => createClient(url, publishableKey), [url, publishableKey]);
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const api = useMemo(
    () =>
      createApi(async () => {
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? null;
      }, "supabase"),
    [supabase],
  );

  if (session === undefined) return null;
  if (!session) return <SignIn supabase={supabase} providers={providers} />;
  return <Deck api={api} onSignOut={() => void supabase.auth.signOut()} />;
}
