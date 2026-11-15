/** The one setting PrepUp has: how you want your assistant to test you. */
import { TESTING_STYLE_MAX } from "@prepup/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { Api, TestingSetup } from "../lib/api.js";
import { guidePath } from "../lib/guide.js";
import { Link } from "./Link.js";

/**
 * A style being written but not yet saved. Kept outside the component so a
 * look at another screen and back doesn't throw the typing away.
 */
let unsavedStyle: string | null = null;

export function TestingStyle({ api, info }: { api: Api; info: TestingSetup }) {
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
      qc.setQueryData<TestingSetup>(["testing-setup"], (old) => (old ? { ...old, settings } : old));
      setJustSaved(true);
    },
  });

  const trimmed = text.trim();
  const dirty = trimmed !== saved;
  const tooLong = trimmed.length > TESTING_STYLE_MAX;
  const active = info.presets.find((p) => p.text === trimmed)?.id ?? null;

  return (
    <section className="panel" aria-labelledby="style-title">
      <h2 id="style-title">How you want to be tested</h2>
      <p className="panel-lead">
        Tell your assistant who to be, how deep to go and what to focus on. Start from a preset, then make it yours.
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
            ? "Saved. New chats use it straight away. In a chat that's already open, ask your assistant to check PrepUp first."
            : dirty
              ? "Not saved yet."
              : ""}
      </p>

      <p className="note">
        Your style shapes tone, depth and focus. It can't change <Link to={guidePath("assistant")}>what never changes</Link>.
      </p>
    </section>
  );
}
