/**
 * The guide's pages, written for someone who has never seen PrepUp and may
 * use any AI app. Facts that live in code (levels, the fade period, the
 * connector's actions and rules) are read from it, so the guide can't drift.
 */
import { useQuery } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { loadConnector, type ConnectorInfo, type HostLinkTargets } from "../../lib/api.js";
import { COUNTDOWN_DAYS, FADE_DAYS, LEVELS, RAMP, TABS } from "../../lib/deck.js";
import { appFor, APPS, cursorConfig, guidePath, PHRASES, type AppId } from "../../lib/guide.js";
import { PATHS } from "../../lib/route.js";
import { Link } from "../Link.js";

export interface PageProps {
  links: HostLinkTargets;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button type="button" className="btn" onClick={() => void copy()}>
      {copied ? "Copied" : label}
    </button>
  );
}

/** Something to say to an assistant, with a button to copy it. */
function Say({ children }: { children: string }) {
  return (
    <span className="say">
      <q>{children}</q>
      <CopyButton text={children} />
    </span>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="guide-note">{children}</p>;
}

function useConnector() {
  return useQuery({ queryKey: ["connector"], queryFn: loadConnector, staleTime: 5 * 60_000 });
}

function Loading({ error }: { error: unknown }) {
  return error ? <p className="error">{(error as Error).message}</p> : <p className="muted">Loading…</p>;
}

function HowItWorks() {
  return (
    <>
      <p className="guide-lead">
        PrepUp is a deck of the things you're learning. Each topic is a card with a score from 1 to 5. An AI assistant
        you already use tests you, and the score lands on the card.
      </p>

      <ol className="flow" aria-label="How PrepUp works, in three steps">
        <li>
          <strong>You add a term</strong>
          <span>The moment you hear it, here or by telling your assistant.</span>
        </li>
        <li>
          <strong>Your assistant tests you</strong>
          <span>One topic at a time, then it suggests a score.</span>
        </li>
        <li>
          <strong>The card shows what you know now</strong>
          <span>It darkens as you learn, and fades if you leave it.</span>
        </li>
      </ol>

      <h2>Who does what</h2>
      <div className="two-up">
        <div>
          <h3>PrepUp</h3>
          <ul>
            <li>Keeps your topics, scores, explanations and history.</li>
            <li>Shows what's weak, and what is about to fade.</li>
            <li>Has no AI of its own.</li>
          </ul>
        </div>
        <div>
          <h3>Your assistant</h3>
          <ul>
            <li>Asks the questions, in the style you choose.</li>
            <li>Suggests a score and drafts your explanation.</li>
            <li>Saves only after you say yes.</li>
          </ul>
        </div>
      </div>
      <p>
        Because the testing runs in your own AI app, on your own plan, PrepUp is free to use, and you decide how you're
        tested.
      </p>

      <h2>What you need</h2>
      <ul>
        <li>An account here. It's free.</li>
        <li>
          An AI app that supports <strong>MCP connectors</strong>. MCP is an open standard that lets AI apps use outside
          tools. Claude, ChatGPT, Cursor and VS Code all support it; Claude is the one PrepUp has been tested with.
        </li>
      </ul>
    </>
  );
}

function Address({ url }: { url: string }) {
  return (
    <div className="copy-row">
      <input className="mono" readOnly value={url} aria-label="Connector address" onFocus={(e) => e.target.select()} />
      <CopyButton text={url} label="Copy address" />
    </div>
  );
}

function AppSteps({ app, url, links }: { app: AppId; url: string; links: HostLinkTargets }) {
  const sameAccount = "Sign in with the same account you use here";
  if (app === "claude") {
    return (
      <>
        <ol className="steps">
          <li>
            In Claude, open <strong>Settings › Connectors</strong> and choose <strong>Add custom connector</strong>.
          </li>
          <li>
            Name it <strong>PrepUp</strong>, paste the address, and press <strong>Connect</strong>.
          </li>
          <li>
            {sameAccount}, then choose <strong>Allow</strong>.
          </li>
        </ol>
        <Note>Add it once on the web or desktop app. It then works in Claude on your phone too.</Note>
      </>
    );
  }
  if (app === "chatgpt") {
    return (
      <>
        <ol className="steps">
          <li>
            Open <strong>chatgpt.com/plugins</strong>, select the plus button, then{" "}
            <strong>Add custom MCP server</strong>.
          </li>
          <li>
            Name it <strong>PrepUp</strong> and paste the address as the server address.
          </li>
          <li>
            Choose <strong>OAuth</strong> for authentication, accept the warning, and select{" "}
            <strong>Create as a plugin</strong>.
          </li>
          <li>{sameAccount}.</li>
          <li>
            In a new chat, type <strong>@</strong> and pick PrepUp.
          </li>
        </ol>
        <Note>
          ChatGPT's menus for custom connectors change often and depend on your plan. If yours look different, follow{" "}
          <a href="https://developers.openai.com/plugins/deploy/connect-chatgpt" target="_blank" rel="noreferrer">
            OpenAI's own steps
          </a>
          . PrepUp has to save your scores, so a plan that only allows read-only connectors can't record a test.
        </Note>
      </>
    );
  }
  if (app === "cursor") {
    return (
      <>
        <ol className="steps">
          <li>
            Open the file <code>~/.cursor/mcp.json</code>, or create it.
          </li>
          <li>
            Add PrepUp to it:
            <div className="code-block">
              <pre>{cursorConfig(url)}</pre>
              <CopyButton text={cursorConfig(url)} />
            </div>
          </li>
          <li>
            Open <strong>Customize</strong> in Cursor's sidebar and check that PrepUp is on.
          </li>
          <li>When Cursor asks you to sign in, use the same account you use here.</li>
        </ol>
        <Note>If the file already lists other servers, add the "prepup" entry beside them.</Note>
      </>
    );
  }
  if (app === "vscode") {
    return (
      <>
        <ol className="steps">
          <li>
            Open the Command Palette and run <strong>MCP: Add Server</strong>.
          </li>
          <li>
            Choose <strong>HTTP (HTTP or Server-Sent Events)</strong> and paste the address.
          </li>
          <li>
            Enter <strong>prepup</strong> as the server ID and choose <strong>Global</strong>.
          </li>
          <li>When VS Code asks you to sign in, use the same account you use here.</li>
          <li>Ask for a test from an agent chat.</li>
        </ol>
        <Note>This needs VS Code's AI features (GitHub Copilot) turned on.</Note>
      </>
    );
  }
  return (
    <>
      <p>Any app that can add a remote MCP server by its address can connect. The app has to support two things:</p>
      <ul>
        <li>
          <strong>Streamable HTTP</strong>, the standard way to reach an MCP server over the web.
        </li>
        <li>
          <strong>Sign-in in the browser (OAuth)</strong>, where the app registers itself with PrepUp the first time.
        </li>
      </ul>
      <ol className="steps">
        <li>
          Find <strong>Add MCP server</strong>, <strong>Custom connector</strong> or a similar option in the app's
          settings.
        </li>
        <li>Paste the address.</li>
        <li>{sameAccount}.</li>
      </ol>
      <Note>
        If the app asks for an API key or a command to run, not an address, it can't connect to PrepUp yet.{" "}
        <a href={links.sourceUrl} target="_blank" rel="noreferrer">
          Tell us
        </a>{" "}
        which app you tried.
      </Note>
    </>
  );
}

function Connect({ links }: PageProps) {
  const connector = useConnector();
  const [app, setApp] = useState<AppId>(() => appFor(window.location.search));
  const choose = (id: AppId) => {
    setApp(id);
    // The address remembers the choice, so a link can point at one app's steps.
    window.history.replaceState(null, "", `${window.location.pathname}?app=${id}`);
  };
  const chosen = APPS.find((a) => a.id === app)!;

  return (
    <>
      <p className="guide-lead">
        Connecting gives your AI app a small set of actions in your deck. You do it once per app, and it takes about
        two minutes.
      </p>

      <h2>1. Copy your connector address</h2>
      {connector.data ? <Address url={connector.data.url} /> : <Loading error={connector.error} />}

      <h2>2. Add it to your app</h2>
      <div className="app-tabs" role="tablist" aria-label="Your AI app">
        {APPS.map((a) => (
          <button
            key={a.id}
            type="button"
            role="tab"
            id={`app-${a.id}`}
            aria-selected={app === a.id}
            aria-controls="app-steps"
            onClick={() => choose(a.id)}
          >
            {a.name}
          </button>
        ))}
      </div>
      <div id="app-steps" role="tabpanel" aria-labelledby={`app-${app}`} className="app-steps">
        {chosen.tested ? (
          <p className="tested">Tested with PrepUp.</p>
        ) : (
          <p className="untested">
            Not yet tested by us.{" "}
            {app === "other"
              ? "PrepUp follows the MCP standard, so this should work, but we haven't tried every app."
              : `These steps follow ${chosen.name}'s own documentation.`}
          </p>
        )}
        {connector.data && <AppSteps app={app} url={connector.data.url} links={links} />}
      </div>

      <h2>3. Check that it worked</h2>
      <p>In a new chat, say:</p>
      <Say>{PHRASES.check}</Say>
      <p>
        Your assistant answers with the number of topics in your deck. If it doesn't, see{" "}
        <Link to={guidePath("troubleshooting")}>Troubleshooting</Link>.
      </p>
    </>
  );
}

function FirstTest() {
  return (
    <>
      <p className="guide-lead">A test is a short conversation. Nothing is saved until you agree to it.</p>

      <ol className="steps roomy">
        <li>
          <strong>Add a few terms.</strong> Type them on the <Link to={PATHS.deck}>Deck</Link> screen, or tell your
          assistant.
        </li>
        <li>
          <strong>Ask for a test.</strong> In a new chat with your assistant, say:
          <Say>{PHRASES.test}</Say>
        </li>
        <li>
          <strong>Answer in your own words.</strong> Your assistant picks what's weak or about to fade and asks about
          one topic at a time.
        </li>
        <li>
          <strong>Read the feedback.</strong> You get what was right, what was missing, a suggested score, and a short
          explanation drafted from what you said.
        </li>
        <li>
          <strong>Say yes, or change it.</strong> You can change the score, edit the explanation, or keep your old
          one. Only then is it saved to the card.
        </li>
      </ol>

      <h2>Other things to say</h2>
      <ul className="say-list">
        <li>
          <Say>{PHRASES.testOne}</Say>
          <span>Test one topic you name.</span>
        </li>
        <li>
          <Say>{PHRASES.fading}</Say>
          <span>Catch the topics about to drop a level.</span>
        </li>
        <li>
          <Say>{PHRASES.add}</Say>
          <span>Add a term without leaving the chat.</span>
        </li>
        <li>
          <Say>{PHRASES.link}</Say>
          <span>Map what a topic builds on.</span>
        </li>
      </ul>
      <Note>
        Naming PrepUp in the request helps your assistant reach for it. From any card you can also press{" "}
        <strong>Copy test prompt</strong> and paste the result into a chat.
      </Note>

      <h2>Make it yours</h2>
      <p>
        In <Link to={PATHS.settings}>Settings</Link> you choose how you want to be tested: as a technical interviewer,
        a patient tutor, a quick drill, or in your own words.
      </p>
    </>
  );
}

function Scores() {
  return (
    <>
      <p className="guide-lead">
        Every topic has one score from 1 to 5. The darker the card, the better you know it.
      </p>

      <ul className="levels">
        {LEVELS.map((name, i) => (
          <li key={name}>
            <span className="level-swatch" style={{ background: RAMP[i], color: i >= 3 ? "#fff" : "#18181b" }} aria-hidden="true">
              {i + 1}
            </span>
            <span>
              <strong>
                <span className="sr-only">{i + 1}: </span>
                {name}
              </strong>
            </span>
          </li>
        ))}
      </ul>
      <p>
        Scores 1 to 4 are how well you understand a topic and can answer questions about it. A <strong>5</strong> means
        you can explain it clearly in your own words, and a test can't record a 5 without that.
      </p>

      <h2>Why a score drops</h2>
      <p>
        What you don't revisit, you forget. A score drops one step for every <strong>{FADE_DAYS} days</strong> without a
        test, so the deck shows what you know now, not what you knew last month.
      </p>
      <ul>
        <li>Only a test with your assistant restarts the {FADE_DAYS}-day clock.</li>
        <li>The card grows paler as the drop comes closer.</li>
        <li>In the last {COUNTDOWN_DAYS} days a rose bar on the card counts down.</li>
        <li>A score of 1 can't drop further.</li>
      </ul>

      <h2>Changing a score yourself</h2>
      <p>
        Open a card and tap a number. It is saved as a manual edit and labelled that way in the card's history. The
        clock keeps running: a manual edit is your estimate, not a test.
      </p>

      <h2>Importance and the filters</h2>
      <p>
        Each card is High, Medium or Low importance. Important topics that are weak or fading come first in the deck.
      </p>
      <ul className="defs">
        {TABS.map((t) => (
          <li key={t.id}>
            <strong>{t.label}</strong>
            <span>{t.hint}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function Links() {
  return (
    <>
      <p className="guide-lead">
        Some topics rest on others. RAG builds on Embeddings and Vector databases. Linking them turns your deck into a
        learning path.
      </p>

      <h2>What a link changes</h2>
      <ul>
        <li>
          <strong>Prep now</strong> lists what a topic builds on ahead of the topic itself.
        </li>
        <li>During a test, a weaker prerequisite is tested first.</li>
        <li>A link never changes a score, and never restarts the fade clock.</li>
      </ul>

      <h2>Adding and removing links</h2>
      <ul>
        <li>
          <strong>Through your assistant.</strong> When you add a topic, it looks for what the topic builds on and
          proposes each link in one line. It links them only after you say yes.
        </li>
        <li>
          <strong>On a card.</strong> Open the card and choose <strong>Add prerequisite</strong>. Remove a link with
          the × on its chip; an Undo appears straight after.
        </li>
      </ul>
      <Note>
        Links can't form a loop: if RAG builds on Embeddings, Embeddings can't build on RAG. A topic can build on up to
        20 others.
      </Note>

      <h2>The graph view</h2>
      <p>
        On the Deck screen, <strong>Graph</strong> draws the same topics as a board you can drag and zoom. Arrows run
        from a topic to what builds on it, so each path reads left to right. Topics with no links sit in a group
        underneath. Tap any topic to open its card.
      </p>
    </>
  );
}

function Rules({ info }: { info: ConnectorInfo }) {
  return (
    <details className="more">
      <summary>How a test runs, rule by rule</summary>
      <ul className="rules">
        {info.fixedRules.map((r) => (
          <li key={r.id}>
            <span>{r.title}</span>
            <span className="why">{r.why}</span>
          </li>
        ))}
      </ul>
      <details className="more inner">
        <summary>Show the exact wording your assistant receives</summary>
        <ol className="exact">
          {info.fixedRules.map((r) => (
            <li key={r.id}>{r.rule}</li>
          ))}
        </ol>
      </details>
    </details>
  );
}

function Assistant() {
  const connector = useConnector();
  const info = connector.data;
  return (
    <>
      <p className="guide-lead">
        Connecting gives your assistant a short list of actions in your deck, and nothing else. PrepUp never sees
        your conversations: it receives only what your assistant sends through these actions.
      </p>

      <h2>Four things that never change</h2>
      {info ? (
        <ul className="promises">
          {info.fixedRules
            .filter((r) => r.promise)
            .map((r) => (
              <li key={r.id}>
                <strong>{r.promise}</strong>
                <span>{r.why}</span>
              </li>
            ))}
        </ul>
      ) : (
        <Loading error={connector.error} />
      )}
      <p>
        These hold however you ask to be tested, and in every AI app. Your{" "}
        <Link to={PATHS.settings}>testing style</Link> shapes tone, depth and focus; it can't switch these off.
      </p>

      <h2>What it can do</h2>
      {info && (
        <>
          <ul className="can-do">
            {info.tools.map((t) => (
              <li key={t.name}>
                <span>{t.title}</span>
                <span className={`badge${t.readOnly ? "" : " writes"}`}>
                  {t.readOnly ? "reads" : "changes your deck"}
                </span>
              </li>
            ))}
          </ul>
          <p>
            It can't delete a topic or erase your data. Only you can, on a card or in{" "}
            <Link to={PATHS.settings}>Settings</Link>.
          </p>

          <h2>The details</h2>
          <div className="details-stack">
            <Rules info={info} />
            <details className="more">
              <summary>Technical details for the curious</summary>
              <ul className="tools">
                {info.tools.map((t) => (
                  <li key={t.name}>
                    <div className="tool-head">
                      <code>{t.name}</code>
                      <span className={`badge${t.readOnly ? "" : " writes"}`}>{t.readOnly ? "reads" : "writes"}</span>
                    </div>
                    <p>{t.description}</p>
                  </li>
                ))}
                {info.prompts.map((p) => (
                  <li key={p.name}>
                    <div className="tool-head">
                      <code>{p.name}</code>
                      <span className="badge">prompt</span>
                    </div>
                    <p>{p.description}</p>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </>
      )}
    </>
  );
}

function Problem({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="more problem">
      <summary>{title}</summary>
      <div className="problem-body">{children}</div>
    </details>
  );
}

function Troubleshooting({ links }: PageProps) {
  return (
    <>
      <p className="guide-lead">The problems people meet most, and what fixes each.</p>

      <h2>Connecting</h2>
      <div className="details-stack">
        <Problem title="My app won't connect, or sign-in fails">
          <ul>
            <li>
              Check the address: it ends in <code>/mcp</code>, with nothing after it.
            </li>
            <li>Remove the connector from your app and add it again.</li>
            <li>
              Check that your app can add a remote MCP server by its address. See{" "}
              <Link to={`${guidePath("connect")}?app=other`}>Another app</Link>.
            </li>
          </ul>
        </Problem>
        <Problem title="It connected, but my deck looks empty there">
          <p>
            Your AI app is signed in to PrepUp with a different account from the one you use here. Each account has its
            own deck. Check which account you're on in <Link to={PATHS.settings}>Settings</Link>, then remove the
            connector and add it again with that account.
          </p>
        </Problem>
        <Problem title="My assistant answers without using PrepUp">
          <p>
            Name PrepUp in your request: <q>{PHRASES.testOne}</q>. Some apps also make you switch the connector on for
            each chat; in ChatGPT, type @ and pick PrepUp.
          </p>
        </Problem>
      </div>

      <h2>Testing</h2>
      <div className="details-stack">
        <Problem title="My testing style is being ignored">
          <p>
            A chat that was open before you changed the style still has the old one. Start a new chat, or say{" "}
            <q>{PHRASES.check}</q>, which hands your assistant the current style.
          </p>
        </Problem>
        <Problem title="My score dropped and I didn't change it">
          <p>
            Scores fade one step every {FADE_DAYS} days without a test. See{" "}
            <Link to={guidePath("scores")}>Scores and fading</Link>.
          </p>
        </Problem>
        <Problem title="A score or explanation is wrong">
          <p>
            Open the card. Tap a number to set the score yourself, and edit the explanation in place. The card's
            history shows every test and edit.
          </p>
        </Problem>
      </div>

      <h2>Limits</h2>
      <div className="details-stack">
        <Problem title="“Too many requests”">
          <p>
            Each person has a per-minute and a per-day limit, so one account can't crowd out the rest. Wait a minute
            and carry on. The numbers are on the <Link to={PATHS.costs}>costs page</Link>.
          </p>
        </Problem>
        <Problem title="“Your deck is full”">
          <p>
            A deck holds a fixed number of topics, shown on the <Link to={PATHS.costs}>costs page</Link>. Delete a
            topic you no longer need to add another.
          </p>
        </Problem>
      </div>

      <h2>Still stuck?</h2>
      <p>
        <a href={links.sourceUrl} target="_blank" rel="noreferrer">
          Open an issue
        </a>{" "}
        on the project page and say which AI app you use.
      </p>
    </>
  );
}

function Data({ links }: PageProps) {
  return (
    <>
      <p className="guide-lead">What PrepUp keeps, how to remove it, and what it costs.</p>

      <h2>What is stored</h2>
      <ul>
        <li>Your topics, their scores and importance, and the links between them.</li>
        <li>Your explanations, and the answers and feedback your assistant records with a test.</li>
        <li>Your testing style.</li>
        <li>The email address you sign in with.</li>
      </ul>
      <p>
        Only you can see your deck. Your conversations stay in your AI app: PrepUp receives only what your assistant
        sends through the connector.
      </p>

      <h2>Removing it</h2>
      <ul>
        <li>
          <strong>One topic:</strong> open its card, choose ⋯, then Delete card. Its history goes with it.
        </li>
        <li>
          <strong>Everything:</strong> <Link to={PATHS.settings}>Settings</Link>, then Erase all my data. Your sign-in
          stays, so you can start again with an empty deck.
        </li>
        <li>
          <strong>The connection:</strong> remove the PrepUp connector in your AI app's settings.
        </li>
      </ul>

      <h2>What it costs</h2>
      <p>
        PrepUp is free to use. There is no AI bill, because the testing runs in your own AI app. The{" "}
        <Link to={PATHS.costs}>costs page</Link> shows what this copy costs to run, how full it is, and the limits each
        person gets.
      </p>
      <p>
        PrepUp is open source.{" "}
        <a href={links.sourceUrl} target="_blank" rel="noreferrer">
          Read the code
        </a>{" "}
        or run a copy of your own.
      </p>
    </>
  );
}

/** One body per page in the table of contents (lib/guide.ts), by its slug. */
export const PAGES: Record<string, (props: PageProps) => ReactNode> = {
  "how-it-works": HowItWorks,
  connect: Connect,
  "first-test": FirstTest,
  scores: Scores,
  links: Links,
  assistant: Assistant,
  troubleshooting: Troubleshooting,
  data: Data,
};
