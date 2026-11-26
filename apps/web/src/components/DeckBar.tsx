/**
 * The row of decks above the deck page. Each deck is drawn as a small fanned
 * stack of cards whose top card takes the colour of how well you know that
 * deck, the same colours as the cards themselves. "All decks" fans out the
 * colours of your first three decks. Pick a deck, make a new one, or rename
 * and delete the open one from its menu. Deleting asks first, in place,
 * because it removes every topic in the deck.
 */
import type { DeckView, TopicView } from "@prepup/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import type { Api } from "../lib/api.js";
import { ALL_DECKS, deckLevel, deckShade, type DeckChoice } from "../lib/deck.js";

type Mode = { kind: "idle" } | { kind: "new" } | { kind: "rename" } | { kind: "delete" };

interface Props {
  api: Api;
  decks: DeckView[];
  /** Every topic, in every deck: each deck's colour comes from its own topics. */
  topics: TopicView[];
  selected: DeckChoice;
  onSelect: (choice: DeckChoice) => void;
  onMessage: (text: string, error?: boolean) => void;
}

const topicCount = (n: number) => (n === 0 ? "Empty" : n === 1 ? "1 topic" : `${n} topics`);

/** Three card outlines, fanned; the top one (or all three, for All decks) filled with a colour. */
function Stack({ shades, empty = false }: { shades: string[]; empty?: boolean }) {
  const [back, middle, top] = shades.length >= 3 ? shades : ["transparent", "transparent", shades[0] ?? "transparent"];
  return (
    <span className={`deck-stack${empty ? " empty" : ""}`} aria-hidden="true">
      <span style={{ "--shade": back } as CSSProperties} />
      <span style={{ "--shade": middle } as CSSProperties} />
      <span style={{ "--shade": top } as CSSProperties} />
    </span>
  );
}

export function DeckBar({ api, decks, topics, selected, onSelect, onMessage }: Props) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>({ kind: "idle" });
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const more = useRef<HTMLDivElement>(null);
  const current = decks.find((d) => d.id === selected);
  const inDeck = (id: string) => topics.filter((t) => t.deck.id === id);

  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (!more.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);

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
  const pick = (choice: DeckChoice) => {
    done();
    setMenuOpen(false);
    onSelect(choice);
  };

  return (
    <section className="deck-bar" aria-label="Decks">
      <div className="deck-row">
        <div className="deck-strip" role="tablist" aria-label="Choose a deck">
          <button
            type="button"
            role="tab"
            className="deck-tab"
            aria-selected={selected === ALL_DECKS}
            aria-label={`All decks, ${topicCount(topics.length)}`}
            onClick={() => pick(ALL_DECKS)}
          >
            <Stack shades={decks.length >= 3 ? decks.slice(0, 3).map((d) => deckShade(inDeck(d.id))) : [deckShade(topics)]} />
            <span className="deck-text">
              <span className="deck-name">All decks</span>
              <span className="deck-meta">{topicCount(topics.length)}</span>
            </span>
          </button>
          {decks.map((d) => {
            const mine = inDeck(d.id);
            return (
              <button
                key={d.id}
                type="button"
                role="tab"
                className="deck-tab"
                aria-selected={selected === d.id}
                aria-label={`${d.name}, ${topicCount(d.topicCount)}, ${deckLevel(mine)}`}
                onClick={() => pick(d.id)}
              >
                <Stack shades={[deckShade(mine)]} />
                <span className="deck-text">
                  <span className="deck-name">{d.name}</span>
                  <span className="deck-meta">{topicCount(d.topicCount)}</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className="deck-tab deck-add"
            aria-pressed={mode.kind === "new"}
            onClick={() => {
              setMenuOpen(false);
              setName("");
              setError(null);
              setMode({ kind: "new" });
            }}
          >
            <Stack shades={[]} empty />
            <span className="deck-text">
              <span className="deck-name">New deck</span>
              <span className="deck-meta">Group topics</span>
            </span>
          </button>
        </div>

        {current && (
          <div className="deck-more" ref={more}>
            <button
              type="button"
              className="icon-btn"
              aria-label={`Options for ${current.name}`}
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span aria-hidden="true">⋯</span>
            </button>
            {menuOpen && (
              <div className="menu">
                <button
                  type="button"
                  className="menu-item"
                  onClick={() => {
                    setMenuOpen(false);
                    setError(null);
                    setName(current.name);
                    setMode({ kind: "rename" });
                  }}
                >
                  Rename deck
                </button>
                <button
                  type="button"
                  className="menu-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    setError(null);
                    setMode({ kind: "delete" });
                  }}
                >
                  Delete deck
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {(mode.kind === "new" || mode.kind === "rename") && (
        <form className="deck-panel deck-form" onSubmit={submit}>
          <label htmlFor="deck-name" className="deck-panel-title">
            {mode.kind === "new" ? "Name your new deck" : `Rename "${current?.name ?? ""}"`}
          </label>
          <div className="deck-form-row">
            <input
              id="deck-name"
              autoFocus
              autoComplete="off"
              maxLength={60}
              placeholder="For example DSA, or System Design"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && done()}
            />
            <button type="button" className="btn" onClick={done} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={busy}>
              {mode.kind === "new" ? (create.isPending ? "Creating…" : "Create deck") : rename.isPending ? "Saving…" : "Save name"}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </form>
      )}

      {mode.kind === "delete" && current && (
        <div className="deck-panel deck-danger" role="group" aria-label="Confirm delete">
          <p className="deck-panel-title">
            Delete "{current.name}" and its {current.topicCount} {current.topicCount === 1 ? "topic" : "topics"}?
          </p>
          <p className="deck-panel-note">Their scores, explanations and links go too. This can't be undone.</p>
          <div className="row-end">
            <button type="button" className="btn" autoFocus onClick={done} disabled={busy}>
              Keep the deck
            </button>
            <button type="button" className="btn danger" onClick={() => remove.mutate(current.id)} disabled={busy}>
              {remove.isPending ? "Deleting…" : "Delete deck"}
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
