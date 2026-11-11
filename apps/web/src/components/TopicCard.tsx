import type { TopicView } from "@prepup/contracts";
import { cardFlags, cardLook } from "../lib/deck.js";

export function TopicCard({ topic, onOpen }: { topic: TopicView; onOpen: () => void }) {
  const look = cardLook(topic);
  const flags = cardFlags(topic);
  const fade = topic.daysUntilDrop === null ? "not fading" : `fades in ${topic.daysUntilDrop} days`;
  return (
    <button
      type="button"
      className="card"
      onClick={onOpen}
      aria-label={`${topic.term}, ${topic.level}, ${topic.score} of 5, ${topic.importance} importance, ${fade}`}
      style={{ background: look.background, borderColor: look.border, color: look.ink }}
    >
      <span className="card-term">{topic.term}</span>
      {/* Only what stands out gets a line: the default importance and a card that isn't about to fade say nothing. */}
      {(flags.importance || flags.fade) && (
        <span className="card-flags">
          {flags.importance && <span>{flags.importance}</span>}
          {flags.fade && <span className="card-fade">{flags.fade}</span>}
        </span>
      )}
      <span className="card-bottom">
        <span>{topic.level}</span>
        <span className="mono">{topic.score}/5</span>
      </span>
      {look.countdown !== null && (
        <span
          className="card-countdown"
          aria-hidden="true"
          style={{ background: look.lightText ? "rgba(255,255,255,0.18)" : "rgba(24,24,27,0.08)" }}
        >
          <span style={{ width: `${Math.round(look.countdown * 100)}%`, background: look.countdownColor }} />
        </span>
      )}
    </button>
  );
}
