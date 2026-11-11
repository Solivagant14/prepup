/** Loads the public config, handles sign-in, then shows the deck. */
import type { OAuthProvider } from "@prepup/contracts";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import { Account } from "./components/Account.js";
import { Costs } from "./components/Costs.js";
import { ClaudeSetup } from "./components/ClaudeSetup.js";
import { Deck } from "./components/Deck.js";
import { Shell } from "./components/Shell.js";
import { SignIn } from "./components/SignIn.js";
import type { AccountInfo } from "./lib/account.js";
import { createApi, loadConfig, type Api, type AppConfig, type HostLinkTargets } from "./lib/api.js";
import { navigate, PATHS, screenFor, TITLES, usePath } from "./lib/route.js";

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devApi = useMemo(() => createApi(async () => null, "dev"), []);
  const screen = screenFor(usePath());

  useEffect(() => {
    loadConfig().then(setConfig, (e: Error) => setError(e.message));
  }, []);

  if (error) return <p className="auth error">{error}</p>;
  if (!config) return null;
  if (config.authMode === "dev") return <Home api={devApi} links={config} account={null} />;
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    // The costs page needs no sign-in settings, so it still shows.
    if (screen === "costs") return <PublicCosts />;
    return <p className="auth error">PrepUp isn't configured yet (missing Supabase settings).</p>;
  }
  return (
    <SupabaseApp
      url={config.supabaseUrl}
      publishableKey={config.supabasePublishableKey}
      providers={config.providers ?? []}
      links={config}
    />
  );
}

/** The signed-in app: the frame, and inside it the screen the address names. */
function Home({
  api,
  links,
  account,
  onSignOut,
}: {
  api: Api;
  links: HostLinkTargets;
  account: AccountInfo | null;
  onSignOut?: () => void;
}) {
  const found = screenFor(usePath());
  const screen = found ?? "deck";
  // An address PrepUp doesn't have shows the deck, and says so in the address bar.
  useEffect(() => {
    if (!found) navigate(PATHS.deck, { replace: true });
  }, [found]);
  useTitle(screen);

  return (
    <Shell screen={screen} account={account} links={links} {...(onSignOut ? { onSignOut } : {})}>
      {screen === "claude" ? (
        <ClaudeSetup api={api} />
      ) : screen === "account" ? (
        <Account api={api} account={account} {...(onSignOut ? { onSignOut } : {})} />
      ) : screen === "costs" ? (
        <Costs />
      ) : (
        <Deck api={api} />
      )}
    </Shell>
  );
}

function useTitle(screen: keyof typeof TITLES) {
  useEffect(() => {
    document.title = TITLES[screen];
  }, [screen]);
}

/** The costs page is public: signed out, it shows by itself instead of the sign-in screen. */
function PublicCosts() {
  useTitle("costs");
  return <Costs standalone />;
}

function SupabaseApp({
  url,
  publishableKey,
  providers,
  links,
}: {
  url: string;
  publishableKey: string;
  providers: OAuthProvider[];
  links: HostLinkTargets;
}) {
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

  const onCosts = screenFor(usePath()) === "costs";
  if (session === undefined) return null;
  if (!session) return onCosts ? <PublicCosts /> : <SignIn supabase={supabase} providers={providers} links={links} />;
  const account: AccountInfo = {
    email: session.user.email ?? null,
    provider: typeof session.user.app_metadata?.provider === "string" ? session.user.app_metadata.provider : null,
  };
  return <Home api={api} links={links} account={account} onSignOut={() => void supabase.auth.signOut()} />;
}
