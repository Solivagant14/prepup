/**
 * The Claude side of PrepUp: how to connect, how you want to be tested, the
 * rules no style can change, and what Claude can do. Everything listed here
 * comes from the server's own definitions.
 */
import { TESTING_STYLE_MAX } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Api, ConnectorInfo } from "../lib/api.js";

export function ClaudeSetup({ api, onSignOut }: { api: Api; onSignOut?: () => void }) {
  const info = useQuery({ queryKey: ["connector"], queryFn: api.connector });

  return (
    <div className="page setup">
      <header className="topbar">
        <a className="brand" href="#/">
          PrepUp
        </a>
        <div className="topbar-right">
          <a className="link-btn" href="#/">
            Back to your deck
          </a>
          {onSignOut && (
            <button type="button" className="link-btn" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

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
      </ol>
      <p className="note">Add it once on the web or desktop app. It then works in Claude on your phone too.</p>
    </section>
  );
}

function TestingStyle({ api, info }: { api: Api; info: ConnectorInfo }) {
  const qc = useQueryClient();
  const saved = info.settings.testingStyle;
  const [text, setText] = useState(saved);
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => setText(saved), [saved]);

  const save = useMutation({
    mutationFn: () => api.saveTestingStyle(text),
    onSuccess: (settings) => {
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
            : ""}
      </p>

      <h3>Rules that always apply</h3>
      <p className="panel-lead">Claude gets these word for word. They keep a score meaning the same thing for everyone, so your style can't change them.</p>
      <ol className="rules">
        {info.fixedRules.map((r) => (
          <li key={r.id}>
            <span>{r.rule}</span>
            <span className="why">{r.why}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Tools({ info }: { info: ConnectorInfo }) {
  return (
    <section className="panel" aria-labelledby="tools-title">
      <h2 id="tools-title">3 · What Claude can do</h2>
      <p className="panel-lead">
        The connector gives Claude these {info.tools.length} tools. It can link topics to what they build on, after you say yes. It can't delete topics or your data; that only happens here.
      </p>
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
      </ul>
      <h3>Shortcuts</h3>
      <p className="panel-lead">Ready-made prompts you can pick from Claude's menu for this connector.</p>
      <ul className="tools">
        {info.prompts.map((p) => (
          <li key={p.name}>
            <div className="tool-head">
              <code>{p.name}</code>
            </div>
            <p>{p.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
