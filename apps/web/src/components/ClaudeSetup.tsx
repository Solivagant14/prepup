/**
 * The Claude side of PrepUp: how to connect, how you want to be tested, the
 * rules no style can change, and what Claude can do. Everything listed here
 * comes from the server's own definitions. The two things to do come first,
 * in everyday words; the exact text Claude receives is one tap away.
 */
import { TESTING_STYLE_MAX } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Api, ConnectorInfo } from "../lib/api.js";
import { FIRST_TEST_PROMPT } from "../lib/deck.js";

export function ClaudeSetup({ api }: { api: Api }) {
  const info = useQuery({ queryKey: ["connector"], queryFn: api.connector });

  return (
    <div className="page setup">
      <div className="setup-head">
        <h1>Claude setup</h1>
        <p>PrepUp has no AI of its own. Tests run in your Claude app, and the scores land in your deck.</p>
      </div>

      {info.isLoading ? (
        <p className="muted">Loading…</p>
      ) : info.isError || !info.data ? (
        <p className="error">{(info.error as Error | null)?.message ?? "Could not load this page"}</p>
      ) : (
        <>
          <Connect url={info.data.url} />
          <TestingStyle api={api} info={info.data} />
          <Rules info={info.data} />
          <Tools info={info.data} />
        </>
      )}
    </div>
  );
}

function Connect({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <section className="panel" aria-labelledby="connect-title">
      <h2 id="connect-title">1 · Connect</h2>
      <div className="copy-row">
        <input className="mono" readOnly value={url} aria-label="Connector URL" onFocus={(e) => e.target.select()} />
        <button type="button" className="btn primary" onClick={() => void copy()}>
          {copied ? "Copied" : "Copy URL"}
        </button>
      </div>
      <ol className="steps">
        <li>
          In Claude, open <strong>Settings › Connectors</strong> and choose <strong>Add custom connector</strong>.
        </li>
        <li>
          Name it <strong>PrepUp</strong>, paste the URL, and press <strong>Connect</strong>.
        </li>
        <li>
          Sign in with the same account you use here, then <strong>Allow</strong>.
        </li>
        <li>
          Start a new chat and say <q>check my PrepUp connection</q>. Claude answers with your topic count.
        </li>
        <li>
          For your first test, say <q>{FIRST_TEST_PROMPT}</q>.
        </li>
      </ol>
      <p className="note">Add it once on the web or desktop app. It then works in Claude on your phone too.</p>
    </section>
  );
}

/**
 * A style being written but not yet saved. Kept outside the component so a
 * look at another screen and back doesn't throw the typing away.
 */
let unsavedStyle: string | null = null;

function TestingStyle({ api, info }: { api: Api; info: ConnectorInfo }) {
  const qc = useQueryClient();
  const saved = info.settings.testingStyle;
  const [text, setTextState] = useState(unsavedStyle ?? saved);
  const [justSaved, setJustSaved] = useState(false);
  const setText = (next: string) => {
    unsavedStyle = next.trim() === saved ? null : next;
    setTextState(next);
  };
  // When the saved style changes underneath (saved here, or on another device), show it, unless there's typing to keep.
  useEffect(() => {
    if (unsavedStyle === null) setTextState(saved);
  }, [saved]);

  const save = useMutation({
    mutationFn: () => api.saveTestingStyle(text),
    onSuccess: (settings) => {
      unsavedStyle = null;
      setTextState(settings.testingStyle);
      qc.setQueryData<ConnectorInfo>(["connector"], (old) => (old ? { ...old, settings } : old));
      setJustSaved(true);
    },
  });

  const trimmed = text.trim();
  const dirty = trimmed !== saved;
  const tooLong = trimmed.length > TESTING_STYLE_MAX;
  const active = info.presets.find((p) => p.text === trimmed)?.id ?? null;

  return (
    <section className="panel" aria-labelledby="style-title">
      <h2 id="style-title">2 · How you want to be tested</h2>
      <p className="panel-lead">
        Tell Claude who to be, how deep to go and what to focus on. Start from a preset, then make it yours.
      </p>

      <div className="presets" role="group" aria-label="Presets">
        {info.presets.map((p) => (
          <button
            key={p.id}
            type="button"
            className="preset"
            aria-pressed={active === p.id}
            onClick={() => {
              setText(p.text);
              setJustSaved(false);
            }}
          >
            <span className="preset-name">{p.name}</span>
            <span className="preset-summary">{p.summary}</span>
          </button>
        ))}
      </div>

      <label className="field">
        <span className="field-label">
          Your testing style <span className="muted">{active ? "" : "· your own wording"}</span>
        </span>
        <textarea
          className="explanation style-text"
          value={text}
          rows={6}
          onChange={(e) => {
            setText(e.target.value);
            setJustSaved(false);
          }}
          aria-describedby="style-count"
        />
      </label>

      <div className="sheet-actions">
        <span id="style-count" className={`mono count${tooLong ? " error" : ""}`}>
          {trimmed.length} / {TESTING_STYLE_MAX}
        </span>
        <div className="row-end">
          {dirty && (
            <button type="button" className="btn" onClick={() => setText(saved)} disabled={save.isPending}>
              Undo changes
            </button>
          )}
          <button
            type="button"
            className="btn primary"
            disabled={!dirty || tooLong || trimmed.length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save style"}
          </button>
        </div>
      </div>
      <p className={`note${save.isError ? " error" : ""}`} role="status">
        {save.isError
          ? (save.error as Error).message
          : justSaved && !dirty
            ? "Saved. New chats use it straight away. In a chat that's already open, ask Claude to check PrepUp first."
            : dirty
              ? "Not saved yet."
              : ""}
      </p>

    </section>
  );
}

function Rules({ info }: { info: ConnectorInfo }) {
  return (
    <section className="panel" aria-labelledby="rules-title">
      <h2 id="rules-title">What never changes</h2>
      <p className="panel-lead">
        However you ask to be tested, these hold. They keep a score meaning the same thing for everyone.
      </p>
      <ul className="rules">
        {info.fixedRules.map((r) => (
          <li key={r.id}>
            <span>{r.title}</span>
            <span className="why">{r.why}</span>
          </li>
        ))}
      </ul>
      <details className="more">
        <summary>Show the exact wording Claude gets</summary>
        <ol className="exact">
          {info.fixedRules.map((r) => (
            <li key={r.id}>{r.rule}</li>
          ))}
        </ol>
      </details>
    </section>
  );
}

function Tools({ info }: { info: ConnectorInfo }) {
  return (
    <section className="panel" aria-labelledby="tools-title">
      <h2 id="tools-title">What Claude can do</h2>
      <p className="panel-lead">
        Once connected, Claude can do these {info.tools.length} things in your deck. It can't delete topics or your
        data; that only happens here.
      </p>
      <ul className="can-do">
        {info.tools.map((t) => (
          <li key={t.name}>
            <span>{t.title}</span>
            <span className={`badge${t.readOnly ? "" : " writes"}`}>{t.readOnly ? "reads" : "changes your deck"}</span>
          </li>
        ))}
      </ul>
      <p className="note">Anything that changes your deck happens only after you say yes in the chat.</p>

      <h3>Shortcuts</h3>
      <p className="panel-lead">Ready-made prompts you can pick from Claude's menu for this connector.</p>
      <ul className="can-do">
        {info.prompts.map((p) => (
          <li key={p.name}>
            <span>
              {p.title} <span className="muted">· {p.description}</span>
            </span>
          </li>
        ))}
      </ul>

      <details className="more">
        <summary>Show the technical details</summary>
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
    </section>
  );
}
