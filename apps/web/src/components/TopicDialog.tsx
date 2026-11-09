/** The card pop-up: importance, score, explanation, freshness, history and the test prompt. */
import type { Importance, TopicView } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../lib/api.js";
import { cardLook, daysAgo, freshnessText, IMPORTANCES, testPrompt } from "../lib/deck.js";

const KIND_LABEL = { claude_test: "Claude test", manual_edit: "Manual edit", explanation: "Explanation updated" };

export function TopicDialog({ api, topic, onClose }: { api: Api; topic: TopicView; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [explanation, setExplanation] = useState(topic.explanation);
  const [edited, setEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          <label className="field-label" htmlFor="explanation">
            Your explanation
          </label>
          <textarea
            id="explanation"
            className="explanation"
            rows={4}
            maxLength={4000}
            placeholder="In your own words, as you'd say it to an interviewer"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
          />
        </div>

        {(history.data?.length ?? 0) > 0 && (
          <div className="field">
            <span className="field-label">History</span>
            <ul className="history">
              {history.data!.slice(0, 5).map((e) => (
                <li key={e.id}>
                  <time dateTime={e.createdAt}>{daysAgo(e.createdAt)}</time>
                  <span>
                    {KIND_LABEL[e.kind]}
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
    </dialog>
  );
}
