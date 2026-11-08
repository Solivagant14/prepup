import type { TopicView } from "@prepup/contracts";
import { cardLook } from "../lib/deck.js";

export function TopicCard({ topic, onOpen }: { topic: TopicView; onOpen: () => void }) {
  const look = cardLook(topic);
  const fade = topic.daysUntilDrop === null ? "not fading" : `fades in ${topic.daysUntilDrop} days`;
  return (
    <button
      type="button"
      className="card"
      onClick={onOpen}
      aria-label={`${topic.term}, ${topic.level}, ${topic.score} of 5, ${fade}`}
      style={{ background: look.background, borderColor: look.border, color: look.ink }}
    >
      <span className="card-top">
        <span style={{ fontWeight: topic.importance === "high" ? 500 : 400 }}>
          {topic.importance[0]!.toUpperCase() + topic.importance.slice(1)}
          <span className="imp-word"> importance</span>
        </span>
        {topic.fadingSoon && <span style={{ fontWeight: 500, whiteSpace: "nowrap" }}>fades in {topic.daysUntilDrop}d</span>}
      </span>
      <span className="card-term">{topic.term}</span>
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
