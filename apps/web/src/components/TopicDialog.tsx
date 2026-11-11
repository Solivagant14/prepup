/**
 * The card pop-up: importance, score, explanation, links, freshness, history
 * and the test prompt. The title and the main action stay in view while the
 * rest scrolls between them; on a phone it rises from the bottom as a sheet.
 */
import type { Importance, TopicRef, TopicView } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type MouseEvent, type SyntheticEvent } from "react";
import type { Api } from "../lib/api.js";
import {
  cardLook,
  daysAgo,
  eventLabel,
  explanationNote,
  freshnessText,
  IMPORTANCES,
  prerequisiteOptions,
  testPrompt,
} from "../lib/deck.js";

interface Props {
  api: Api;
  topic: TopicView;
  /** The whole deck: what the prerequisite search looks through. */
  topics: TopicView[];
  /** Opens another card in place of this one (a tapped chip). */
  onOpenTopic: (id: string) => void;
  onClose: () => void;
  onDeleted: (term: string) => void;
}

/** One "builds on" link, with the other topic's name for messages about it. */
interface LinkPair {
  topicId: string;
  buildsOnId: string;
  term: string;
}

export function TopicDialog({ api, topic, topics, onOpenTopic, onClose, onDeleted }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [explanation, setExplanation] = useState(topic.explanation);
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  /** A link just removed, kept so it can be put back. */
  const [removed, setRemoved] = useState<LinkPair | null>(null);
  /** What the person was about to do when we stopped to ask about unsaved text. */
  const [leaving, setLeaving] = useState<{ go: () => void } | null>(null);
  const pressedBackdrop = useRef(false);
  const more = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  const history = useQuery({ queryKey: ["history", topic.id], queryFn: () => api.history(topic.id) });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["topics"] });
    void qc.invalidateQueries({ queryKey: ["history", topic.id] });
  };
  const onError = (e: Error) => setError(e.message);

  const update = useMutation({
    mutationFn: (body: { importance?: Importance; explanation?: string }) => api.updateTopic(topic.id, body),
    onSuccess: (saved) => {
      // Show the saved card at once, so "unsaved" clears without waiting for the deck to reload.
      qc.setQueryData<TopicView[]>(["topics"], (list) => list?.map((t) => (t.id === saved.id ? saved : t)));
      refresh();
    },
    onError,
  });

  const dirty = explanation !== topic.explanation;
  const close = () => ref.current?.close();
  /** Runs `go` now, or asks first when typed text would be lost. */
  const attempt = (go: () => void) => {
    setMenuOpen(false);
    if (dirty) setLeaving({ go });
    else go();
  };
  const save = (then?: () => void) =>
    update.mutate(
      { explanation },
      {
        onSuccess: () => {
          setJustSaved(true);
          then?.();
        },
      },
    );
  const discard = () => {
    setExplanation(topic.explanation);
    setJustSaved(false);
  };

  // Escape closes the innermost thing first: the menu, then a question, then the card.
  const onCancel = (e: SyntheticEvent<HTMLDialogElement>) => {
    if (menuOpen) {
      e.preventDefault();
      setMenuOpen(false);
    } else if (leaving) {
      e.preventDefault();
      setLeaving(null);
    } else if (confirmDelete) {
      e.preventDefault();
      setConfirmDelete(false);
    } else if (dirty) {
      e.preventDefault();
      setLeaving({ go: close });
    }
  };
  // A click on the dimmed area closes the card, but not a drag that began inside it (selecting text, say).
  const onBackdropDown = (e: MouseEvent<HTMLDialogElement>) => {
    pressedBackdrop.current = e.target === ref.current;
  };
  const onBackdropClick = (e: MouseEvent<HTMLDialogElement>) => {
    if (e.target === ref.current && pressedBackdrop.current) attempt(close);
  };
  useEffect(() => {
    if (!menuOpen) return;
    const away = (e: PointerEvent) => {
      if (!more.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [menuOpen]);
  const score = useMutation({
    mutationFn: (n: number) => api.setScore(topic.id, n),
    onSuccess: () => {
      setEdited(true);
      refresh();
    },
    onError,
  });

  const onLinkChange = {
    onMutate: () => setLinkError(null),
    onSuccess: () => {
      setAdding(false);
      setQuery("");
      setRemoved(null);
      refresh();
    },
    // The deck may have changed elsewhere (say, Claude linked something): reload it so the options are right.
    onError: (e: Error) => {
      setLinkError(e.message);
      refresh();
    },
  };
  const link = useMutation({ mutationFn: (buildsOnId: string) => api.linkTopic(topic.id, buildsOnId), ...onLinkChange });
  const unlink = useMutation({
    mutationFn: (pair: LinkPair) => api.unlinkTopic(pair.topicId, pair.buildsOnId),
    ...onLinkChange,
    onSuccess: (_topic: TopicView, pair: LinkPair) => {
      onLinkChange.onSuccess();
      setRemoved(pair);
    },
  });
  /** Undo: puts a removed link back, whichever side of it this card is on. */
  const relink = useMutation({
    mutationFn: (pair: LinkPair) => api.linkTopic(pair.topicId, pair.buildsOnId),
    ...onLinkChange,
  });
  const linking = link.isPending || unlink.isPending || relink.isPending;
  const undoNote = (side: "buildsOn" | "neededFor") =>
    removed && (removed.topicId === topic.id) === (side === "buildsOn") ? (
      <p className="undo-note" role="status">
        Removed the link to {removed.term}.
        <button type="button" disabled={linking} onClick={() => relink.mutate(removed)}>
          Undo
        </button>
      </p>
    ) : null;
  const found = adding ? prerequisiteOptions(topic, topics, query) : null;

  const chips = (refs: TopicRef[], pairFor: (other: TopicRef) => LinkPair) => (
    <ul className="chips">
      {refs.map((other) => (
        <li key={other.id} className="chip">
          <button type="button" className="chip-open" onClick={() => attempt(() => onOpenTopic(other.id))} aria-label={`Open ${other.term}`}>
            {other.term}
          </button>
          <button
            type="button"
            className="chip-remove"
            aria-label={`Remove the link to ${other.term}`}
            disabled={linking}
            onClick={() => unlink.mutate(pairFor(other))}
          >
            ×
          </button>
        </li>
      ))}
    </ul>
  );

  const remove = useMutation({
    mutationFn: () => api.deleteTopic(topic.id),
    onSuccess: ({ deleted }) => {
      qc.setQueryData<TopicView[]>(["topics"], (list) => list?.filter((t) => t.id !== topic.id));
      void qc.invalidateQueries({ queryKey: ["topics"] });
      onDeleted(deleted.term);
      ref.current?.close();
    },
    onError,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(testPrompt(topic.term));
      setCopied(true);
    } catch {
      setError("Couldn't copy. Ask Claude: " + testPrompt(topic.term));
    }
  };

  const look = cardLook(topic);
  const fresh = freshnessText(topic);
  const lastTested = topic.lastTestedAt ? `last tested ${daysAgo(topic.lastTestedAt)}` : "never tested by Claude";

  return (
    <dialog
      ref={ref}
      className="card-sheet"
      aria-labelledby="sheet-title"
      onClose={onClose}
      onCancel={onCancel}
      onMouseDown={onBackdropDown}
      onClick={onBackdropClick}
    >
      <header className="sheet-top">
        <div className="sheet-top-text">
          <span className="sheet-level">
            <span className="swatch" style={{ background: look.background }} />
            {topic.level}
          </span>
          <h2 id="sheet-title" className="sheet-title">
            {topic.term}
          </h2>
          {topic.sourceUrl && (
            <a className="source-link" href={topic.sourceUrl} target="_blank" rel="noreferrer noopener">
              {topic.sourceUrl}
            </a>
          )}
        </div>
        <div className="sheet-top-actions">
          <div className="sheet-more" ref={more}>
            <button
              type="button"
              className="icon-btn"
              aria-label="More actions"
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
                  className="menu-item danger"
                  onClick={() => {
                    setMenuOpen(false);
                    setLeaving(null);
                    setConfirmDelete(true);
                  }}
                >
                  Delete card
                </button>
              </div>
            )}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => attempt(close)}>
            <span aria-hidden="true">×</span>
          </button>
        </div>
      </header>

      <div className="sheet-scroll">
        <div className="fresh">
          <div className="fresh-row">
            <span className="fresh-title">{fresh ?? "Not fading: it can't drop below 1"}</span>
            <span className="small">{lastTested}</span>
          </div>
          {look.countdown !== null && (
            <div className="fresh-bar" aria-hidden="true">
              <span style={{ width: `${Math.round(look.countdown * 100)}%` }} />
            </div>
          )}
          <span className="small">Only a test with Claude resets the 14-day clock. The countdown starts 3 days before a drop.</span>
        </div>

        <div className="field">
          <span className="field-label" id="imp-label">
            Importance
          </span>
          <div className="segmented" role="radiogroup" aria-labelledby="imp-label">
            {IMPORTANCES.map((i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={topic.importance === i}
                disabled={update.isPending}
                onClick={() => topic.importance !== i && update.mutate({ importance: i })}
              >
                {i}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <div className="fresh-row">
            <span className="field-label" id="score-label">
              Confidence
            </span>
            <span className="small">tap to edit</span>
          </div>
          <div className="scores" role="radiogroup" aria-labelledby="score-label">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={topic.score === n}
                aria-label={`Set score to ${n}`}
                className={`${n <= topic.score ? "on" : ""}${n === 5 ? " five" : ""}`}
                disabled={score.isPending}
                onClick={() => topic.score !== n && score.mutate(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="scale-note">
            <span>1–4 · understand it and answer questions</span>
            <span>5 · can explain it</span>
          </div>
          {edited && <span className="small">Saved as a manual edit · the fade clock keeps running</span>}
        </div>

        <div className="field">
          <div className="fresh-row">
            <label className="field-label" htmlFor="explanation">
              Your explanation
            </label>
            {explanationNote(topic) && (
              <span className="small" id="explanation-note">
                {explanationNote(topic)}
              </span>
            )}
          </div>
          <textarea
            id="explanation"
            aria-describedby={topic.explanationBy ? "explanation-note" : undefined}
            className="explanation"
            rows={4}
            maxLength={4000}
            placeholder="In your own words, as you'd explain it to someone else"
            value={explanation}
            onChange={(e) => {
              setExplanation(e.target.value);
              setJustSaved(false);
            }}
          />
          {dirty ? (
            <div className="explain-actions">
              <span className="small">Not saved yet</span>
              <div className="row-end">
                <button type="button" className="btn" onClick={discard} disabled={update.isPending}>
                  Discard
                </button>
                <button type="button" className="btn primary" onClick={() => save()} disabled={update.isPending}>
                  {update.isPending ? "Saving…" : "Save"}
                </button>
              </div>
            </div>
          ) : (
            <span className="small" role="status">
              {justSaved ? "Saved" : ""}
            </span>
          )}
        </div>

        <div className="field">
          <div className="fresh-row">
            <span className="field-label" id="builds-on-label">
              Builds on
            </span>
            <span className="small">what to learn first</span>
          </div>
          {topic.buildsOn.length > 0 && chips(topic.buildsOn, (other) => ({ topicId: topic.id, buildsOnId: other.id, term: other.term }))}
          {adding ? (
            <div className="link-search">
              <div className="link-search-row">
                <label htmlFor="prerequisite-search" className="sr-only">
                  Search your topics for a prerequisite
                </label>
                <input
                  id="prerequisite-search"
                  autoFocus
                  autoComplete="off"
                  placeholder="Search your topics…"
                  value={query}
                  maxLength={80}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setAdding(false);
                    setQuery("");
                  }}
                >
                  Cancel
                </button>
              </div>
              {found!.options.length > 0 ? (
                <ul className="link-options" aria-label="Topics you can link">
                  {found!.options.map((o) => (
                    <li key={o.id}>
                      <button type="button" disabled={o.blocked !== null || linking} onClick={() => link.mutate(o.id)}>
                        <span>{o.term}</span>
                        {o.blocked && <span className="small">{o.blocked}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="small">
                  {topics.length <= 1 ? "Add another topic to your deck first." : "No other topic matches."}
                </span>
              )}
              {found!.more > 0 && <span className="small">{found!.more} more · keep typing to narrow it down</span>}
            </div>
          ) : (
            <button type="button" className="btn add-link" onClick={() => setAdding(true)}>
              + Add prerequisite
            </button>
          )}
          {undoNote("buildsOn")}
          {linkError && (
            <p className="error" role="alert" style={{ margin: 0 }}>
              {linkError}
            </p>
          )}
        </div>

        {(topic.neededFor.length > 0 || undoNote("neededFor")) && (
          <div className="field">
            <div className="fresh-row">
              <span className="field-label">Needed for</span>
              <span className="small">what builds on this</span>
            </div>
            {topic.neededFor.length > 0 &&
              chips(topic.neededFor, (other) => ({ topicId: other.id, buildsOnId: topic.id, term: other.term }))}
            {undoNote("neededFor")}
          </div>
        )}

        {(history.data?.length ?? 0) > 0 && (
          <div className="field">
            <span className="field-label">History</span>
            <ul className="history">
              {history.data!.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <time dateTime={e.createdAt}>{daysAgo(e.createdAt)}</time>
                  <span>
                    {eventLabel(e)}
                    {e.score !== null && ` · ${e.score}/5`}
                    {e.feedback && <span className="muted"> · {e.feedback}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

      </div>

      <footer className="sheet-foot">
        {error && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}
        {confirmDelete ? (
          <div className="foot-ask" role="group" aria-label="Confirm delete">
            <span>Delete "{topic.term}" and its history? This can't be undone.</span>
            <div className="row-end">
              <button type="button" className="btn" autoFocus onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? "Deleting…" : "Delete card"}
              </button>
            </div>
          </div>
        ) : leaving ? (
          <div className="foot-ask" role="group" aria-label="Unsaved explanation">
            <span>You haven't saved your explanation.</span>
            <div className="row-end">
              <button type="button" className="btn" onClick={() => setLeaving(null)} disabled={update.isPending}>
                Keep editing
              </button>
              <button
                type="button"
                className="btn"
                disabled={update.isPending}
                onClick={() => {
                  discard();
                  leaving.go();
                }}
              >
                Discard
              </button>
              <button type="button" className="btn primary" autoFocus disabled={update.isPending} onClick={() => save(leaving.go)}>
                {update.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn primary wide" onClick={() => void copy()}>
            {copied ? "Copied · paste it in Claude" : "Copy test prompt"}
          </button>
        )}
      </footer>
    </dialog>
  );
}
