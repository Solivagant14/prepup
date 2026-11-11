/** The one main screen: capture, progress, filters and the card grid. */
import type { TopicView } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import type { Api } from "../lib/api.js";
import { linkPairs, shownIn, summarize, TABS, type Tab } from "../lib/deck.js";
import { GraphBoard } from "./GraphBoard.js";
import { TopicCard } from "./TopicCard.js";
import { TopicDialog } from "./TopicDialog.js";
import { Tracker } from "./Tracker.js";

type ViewMode = "cards" | "graph";
const VIEWS: { id: ViewMode; label: string }[] = [
  { id: "cards", label: "Cards" },
  { id: "graph", label: "Graph" },
];
const VIEW_KEY = "prepup.view";

/** Which view was open last time, on this device. A convenience only: storage may be unavailable. */
function savedView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === "graph" ? "graph" : "cards";
  } catch {
    return "cards";
  }
}

export function Deck({ api }: { api: Api }) {
  const qc = useQueryClient();
  const topics = useQuery({ queryKey: ["topics"], queryFn: api.listTopics });
  const [tab, setTab] = useState<Tab>("all");
  const [view, setView] = useState<ViewMode>(savedView);
  const show = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Private windows may refuse storage; the view still switches.
    }
  };
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);

  const add = useMutation({
    mutationFn: api.addTopic,
    onSuccess: ({ topic, created }) => {
      setStatus({ text: created ? `Added "${topic.term}"` : `"${topic.term}" is already in your deck` });
      void qc.invalidateQueries({ queryKey: ["topics"] });
    },
    onError: (e: Error) => setStatus({ text: e.message, error: true }),
  });

  const capture = (e: KeyboardEvent<HTMLInputElement>) => {
    const term = draft.trim();
    if (e.key !== "Enter" || !term || add.isPending) return;
    setDraft("");
    add.mutate(term);
  };

  const all = topics.data ?? [];
  const shown = shownIn(tab, all);
  const summary = summarize(all);
  const counts: Record<Tab, number> = {
    all: summary.total,
    prep: summary.prep,
    fading_week: summary.fadingWeek,
    confident: summary.confident,
  };
  const linkCount = linkPairs(all).length;
  const open: TopicView | undefined = all.find((t) => t.id === openId);

  return (
    <div className="page">
      <div className="capture">
        <label htmlFor="capture" className="sr-only">
          Add a term
        </label>
        <input
          id="capture"
          autoComplete="off"
          placeholder="Add a term you just heard…"
          value={draft}
          maxLength={80}
          onChange={(e) => {
            setDraft(e.target.value);
            setStatus(null);
          }}
          onKeyDown={capture}
        />
        <span className="capture-hint" aria-hidden="true">
          ↵ to add
        </span>
      </div>
      <p className={`capture-status${status?.error ? " error" : ""}`} role="status">
        {add.isPending ? "Adding…" : status?.text}
      </p>

      <Tracker summary={summary} />

      <div className="views" role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            id={`view-${v.id}`}
            className="view-tab"
            aria-selected={view === v.id}
            aria-controls="deck-view"
            onClick={() => show(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "cards" && (
        <>
          <div className="toolbar">
            <div className="tabs" role="tablist" aria-label="Filter topics">
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                  {t.label} <span className="mono">{counts[t.id]}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="tab-hint">{TABS.find((t) => t.id === tab)!.hint}</p>
        </>
      )}
      {view === "graph" && (
        <p className="tab-hint view-hint">
          {linkCount === 0
            ? "No links yet. Open a card and add what it builds on, or ask Claude to link your topics."
            : "Arrows run from a topic to what builds on it, so each path reads left to right."}{" "}
          Drag to move, pinch or Ctrl + scroll to zoom, tap a topic to open it.
        </p>
      )}

      <div id="deck-view" role="tabpanel" aria-labelledby={`view-${view}`}>
        {topics.isLoading ? (
          <p className="muted">Loading your deck…</p>
        ) : topics.isError ? (
          <p className="error">{(topics.error as Error).message}</p>
        ) : all.length === 0 ? (
          <p className="empty">Your deck is empty. Add the first term you want to learn above.</p>
        ) : view === "graph" ? (
          <GraphBoard topics={all} onOpen={setOpenId} />
        ) : shown.length === 0 ? (
          <p className="empty">Nothing here right now.</p>
        ) : (
          <div className="grid">
            {shown.map((t) => (
              <TopicCard key={t.id} topic={t} onOpen={() => setOpenId(t.id)} />
            ))}
          </div>
        )}
      </div>

      {open && (
        <TopicDialog
          // A new key per card, so tapping a chip opens the other card with a clean slate.
          key={open.id}
          api={api}
          topic={open}
          topics={all}
          onOpenTopic={setOpenId}
          onClose={() => setOpenId(null)}
          onDeleted={(term) => setStatus({ text: `Deleted "${term}"` })}
        />
      )}

    </div>
  );
}
