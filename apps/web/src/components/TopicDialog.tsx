/** The card pop-up: importance, score, explanation, links, freshness, history and the test prompt. */
import type { Importance, TopicRef, TopicView } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
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
    onSuccess: refresh,
    onError,
  });
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
    mutationFn: (pair: { topicId: string; buildsOnId: string }) => api.unlinkTopic(pair.topicId, pair.buildsOnId),
    ...onLinkChange,
  });
  const linking = link.isPending || unlink.isPending;
  const found = adding ? prerequisiteOptions(topic, topics, query) : null;

  const chips = (refs: TopicRef[], pairFor: (other: TopicRef) => { topicId: string; buildsOnId: string }) => (
    <ul className="chips">
      {refs.map((other) => (
        <li key={other.id} className="chip">
          <button type="button" className="chip-open" onClick={() => onOpenTopic(other.id)} aria-label={`Open ${other.term}`}>
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
    <dialog ref={ref} className="sheet" aria-labelledby="sheet-title" onClose={onClose}>
      <div className="sheet-body">
        <div className="sheet-head">
          <div>
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
          <button type="button" className="icon-btn" aria-label="Close" onClick={() => ref.current?.close()}>
            ×
          </button>
        </div>

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
            onChange={(e) => setExplanation(e.target.value)}
          />
        </div>

        <div className="field">
          <div className="fresh-row">
            <span className="field-label" id="builds-on-label">
              Builds on
            </span>
            <span className="small">what to learn first</span>
          </div>
          {topic.buildsOn.length > 0 && chips(topic.buildsOn, (other) => ({ topicId: topic.id, buildsOnId: other.id }))}
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
          {linkError && (
            <p className="error" role="alert" style={{ margin: 0 }}>
              {linkError}
            </p>
          )}
        </div>

        {topic.neededFor.length > 0 && (
          <div className="field">
            <div className="fresh-row">
              <span className="field-label">Needed for</span>
              <span className="small">what builds on this</span>
            </div>
            {chips(topic.neededFor, (other) => ({ topicId: other.id, buildsOnId: topic.id }))}
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

        {error && (
          <p className="error" role="alert" style={{ margin: 0 }}>
            {error}
          </p>
        )}

        {confirmDelete ? (
          <div
            className="confirm-delete"
            role="group"
            aria-label="Confirm delete"
            ref={(el) => el?.scrollIntoView({ block: "nearest" })}
          >
            <span>Delete "{topic.term}" and its history? This can't be undone.</span>
            <div className="row-end">
              <button type="button" className="btn" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>
                Cancel
              </button>
              <button type="button" className="btn danger" onClick={() => remove.mutate()} disabled={remove.isPending}>
                {remove.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        ) : (
          <div className="sheet-actions">
            <button type="button" className="link-btn delete-link" onClick={() => setConfirmDelete(true)}>
              Delete card
            </button>
            <div className="row-end">
              <button
                type="button"
                className="btn"
                disabled={update.isPending || explanation === topic.explanation}
                onClick={() => update.mutate({ explanation })}
              >
                {update.isPending ? "Saving…" : "Save explanation"}
              </button>
              <button type="button" className="btn primary" onClick={() => void copy()}>
                {copied ? "Copied · paste it in Claude" : "Copy test prompt"}
              </button>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
