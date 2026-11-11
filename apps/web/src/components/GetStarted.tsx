/**
 * The first visit: the three steps from an empty deck to a first test. It
 * goes away by itself once Claude has tested something, or when dismissed.
 */
import { useState } from "react";
import { FIRST_TEST_PROMPT, type StartStepId } from "../lib/deck.js";
import { PATHS } from "../lib/route.js";
import { Link } from "./Link.js";

export function GetStarted({ steps, onHide }: { steps: { id: StartStepId; done: boolean }[]; onHide: () => void }) {
  const [copied, setCopied] = useState(false);
  const done = (id: StartStepId) => steps.find((s) => s.id === id)?.done ?? false;
  // The first step still to do is the one to draw the eye to.
  const next = steps.find((s) => !s.done)?.id;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(FIRST_TEST_PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };
  const mark = (id: StartStepId, n: number) => (
    <span className="start-mark" aria-hidden="true">
      {done(id) ? "✓" : n}
    </span>
  );

  return (
    <section className="start" aria-labelledby="start-title">
      <div className="start-head">
        <div>
          <h2 id="start-title">Get started</h2>
          <p>PrepUp keeps the record. Your own Claude does the testing.</p>
        </div>
        <button type="button" className="icon-btn" aria-label="Hide these steps" onClick={onHide}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      <ol className="start-steps">
        <li className={done("add") ? "done" : next === "add" ? "next" : ""}>
          {mark("add", 1)}
          <div>
            <strong>Add a term you want to learn</strong>
            <p>{done("add") ? "Done. Add more whenever you hear one." : "Type it in the box above. Each term becomes a card."}</p>
          </div>
        </li>
        <li className={next === "connect" ? "next" : ""}>
          {mark("connect", 2)}
          <div>
            <strong>Connect Claude</strong>
            <p>A one-time setup that takes about two minutes.</p>
            <Link to={PATHS.claude} className={`btn${next === "connect" ? " primary" : ""}`}>
              Open Claude setup
            </Link>
          </div>
        </li>
        <li>
          {mark("test", 3)}
          <div>
            <strong>Take your first test</strong>
            <p className="keep">In a new Claude chat, say:</p>
            <div className="start-say">
              <q>{FIRST_TEST_PROMPT}</q>
              <button type="button" className="btn" onClick={() => void copy()}>
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </li>
      </ol>
    </section>
  );
}
