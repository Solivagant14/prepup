/**
 * The row of decks above the deck page: pick one deck or all of them, make a
 * new deck, rename or delete the one that's open. Deleting asks first, in
 * place, because it removes every topic in the deck.
 */
import type { DeckView } from "@prepup/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import type { Api } from "../lib/api.js";
import { ALL_DECKS, type DeckChoice } from "../lib/deck.js";

type Mode = { kind: "idle" } | { kind: "new" } | { kind: "rename" } | { kind: "delete" };

interface Props {
  api: Api;
  decks: DeckView[];
  /** How many topics there are across every deck. */
  total: number;
  selected: DeckChoice;
  onSelect: (choice: DeckChoice) => void;
  onMessage: (text: string, error?: boolean) => void;
}

export function DeckBar({ api, decks, total, selected, onSelect, onMessage }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = decks.find((d) => d.id === selected);

  const done = () => {
    setMode({ kind: "idle" });
    setName("");
    setError(null);
  };
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["decks"] });
    void qc.invalidateQueries({ queryKey: ["topics"] });
  };
  const onError = (e: Error) => setError(e.message);

  const create = useMutation({
    mutationFn: api.createDeck,
    onSuccess: ({ deck, created }) => {
      done();
      reload();
      onSelect(deck.id);
      onMessage(created ? `Created the deck "${deck.name}"` : `You already have "${deck.name}"`);
    },
    onError,
  });
  const rename = useMutation({
    mutationFn: ({ id, to }: { id: string; to: string }) => api.renameDeck(id, to),
    onSuccess: (deck) => {
      done();
      reload();
      onMessage(`Renamed to "${deck.name}"`);
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteDeck(id),
    onSuccess: ({ deleted }) => {
      done();
      reload();
      onSelect(ALL_DECKS);
      onMessage(`Deleted "${deleted.name}" and its ${deleted.topicCount} ${deleted.topicCount === 1 ? "topic" : "topics"}`);
    },
    onError,
  });
  const busy = create.isPending || rename.isPending || remove.isPending;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return setError("Give the deck a name");
    if (mode.kind === "new") create.mutate(value);
    else if (mode.kind === "rename" && current) rename.mutate({ id: current.id, to: value });
  };

  return (
    <section className="deck-bar" aria-label="Decks">
      <div className="tabs deck-tabs" role="tablist" aria-label="Choose a deck">
        <button
          type="button"
          role="tab"
          className="tab"
          aria-selected={selected === ALL_DECKS}
          aria-label={`All decks, ${total}`}
          onClick={() => {
            done();
            onSelect(ALL_DECKS);
          }}
        >
          All decks <span className="mono">{total}</span>
        </button>
        {decks.map((d) => (
          <button
            key={d.id}
            type="button"
            role="tab"
            className="tab"
            aria-selected={selected === d.id}
            aria-label={`${d.name}, ${d.topicCount}`}
            onClick={() => {
              done();
              onSelect(d.id);
            }}
          >
            {d.name} <span className="mono">{d.topicCount}</span>
          </button>
        ))}
        {mode.kind === "idle" && (
          <button type="button" className="tab deck-new" onClick={() => setMode({ kind: "new" })}>
            + New deck
          </button>
        )}
      </div>

      {mode.kind === "idle" && current && (
        <div className="deck-actions">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setName(current.name);
              setMode({ kind: "rename" });
            }}
          >
            Rename
          </button>
          <button type="button" className="link-btn danger" onClick={() => setMode({ kind: "delete" })}>
            Delete deck
          </button>
        </div>
      )}

      {(mode.kind === "new" || mode.kind === "rename") && (
        <form className="deck-form" onSubmit={submit}>
          <label htmlFor="deck-name" className="sr-only">
            {mode.kind === "new" ? "New deck name" : "Deck name"}
          </label>
          <input
            id="deck-name"
            autoFocus
            autoComplete="off"
            maxLength={60}
            placeholder={mode.kind === "new" ? "Name the deck, e.g. DSA" : "Deck name"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && done()}
          />
          <button type="button" className="btn" onClick={done} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {mode.kind === "new" ? (create.isPending ? "Creating…" : "Create") : rename.isPending ? "Saving…" : "Save"}
          </button>
        </form>
      )}

      {mode.kind === "delete" && current && (
        <div className="foot-ask deck-ask" role="group" aria-label="Confirm delete">
          <span>
            Delete "{current.name}" and its {current.topicCount} {current.topicCount === 1 ? "topic" : "topics"}, with their
            history? This can't be undone.
          </span>
          <div className="row-end">
            <button type="button" className="btn" autoFocus onClick={done} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="btn danger" onClick={() => remove.mutate(current.id)} disabled={busy}>
              {remove.isPending ? "Deleting…" : "Delete deck"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
