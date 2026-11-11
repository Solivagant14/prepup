/** The one main screen: capture, progress, filters and the card grid. */
import type { TopicView } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type FormEvent } from "react";
import type { Api } from "../lib/api.js";
import { linkPairs, shownIn, startSteps, summarize, TABS, type Tab } from "../lib/deck.js";
import { GetStarted } from "./GetStarted.js";
import { GraphBoard } from "./GraphBoard.js";
import { TopicCard } from "./TopicCard.js";
import { Toast, type ToastMessage } from "./Toast.js";
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

const START_KEY = "prepup.start.hidden";

/** Whether this person dismissed the first-visit steps on this device. */
function startHidden(): boolean {
  try {
    return localStorage.getItem(START_KEY) === "1";
  } catch {
    return false;
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
  const input = useRef<HTMLInputElement>(null);
  const [hideStart, setHideStart] = useState(startHidden);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const say = (message: Omit<ToastMessage, "id">) => setToast({ id: Date.now(), ...message });
  const clearToast = useCallback(() => setToast(null), []);
  const reload = () => void qc.invalidateQueries({ queryKey: ["topics"] });

  /** Undo for a card added a moment ago: it has no history yet, so nothing else is lost. */
  const undoAdd = useMutation({
    mutationFn: (id: string) => api.deleteTopic(id),
    onSuccess: ({ deleted }) => {
      say({ text: `Removed "${deleted.term}"` });
      reload();
    },
    onError: (e: Error) => say({ text: e.message, error: true }),
  });
  const add = useMutation({
    mutationFn: api.addTopic,
    onSuccess: ({ topic, created }) => {
      say(
        created
          ? { text: `Added "${topic.term}"`, action: { label: "Undo", run: () => undoAdd.mutate(topic.id) } }
          : { text: `"${topic.term}" is already in your deck`, action: { label: "Open", run: () => { setOpenId(topic.id); setToast(null); } } },
      );
      reload();
    },
    onError: (e: Error, term) => {
      // Give the words back, so a failed add doesn't cost the person their typing.
      setDraft((now) => now || term);
      say({ text: e.message, error: true });
    },
  });

  const capture = (e: FormEvent) => {
    e.preventDefault();
    const term = draft.trim();
    if (!term) return input.current?.focus();
    if (add.isPending) return;
    setDraft("");
    add.mutate(term);
  };
  const hide = () => {
    setHideStart(true);
    try {
      localStorage.setItem(START_KEY, "1");
    } catch {
      // Without storage the steps come back next visit; hiding still works for now.
    }
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
  const steps = topics.isSuccess && !hideStart ? startSteps(all) : null;
  const empty = topics.isSuccess && all.length === 0;

  return (
    <div className="page">
      <form className="capture" onSubmit={capture}>
        <label htmlFor="capture" className="sr-only">
          Add a term
        </label>
        <input
          id="capture"
          ref={input}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="Add a term you just heard…"
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" className="btn primary" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add"}
        </button>
      </form>

      {steps && <GetStarted steps={steps} onHide={hide} />}

      {empty ? (
        !steps && <p className="empty">Your deck is empty. Add the first term you want to learn above.</p>
      ) : (
        <>
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
                    <button
                      key={t.id}
                      type="button"
                      role="tab"
                      className="tab"
                      aria-label={`${t.label}, ${counts[t.id]}`}
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                    >
                      {t.short ? (
                        <>
                          <span className="tab-long">{t.label}</span>
                          <span className="tab-short">{t.short}</span>
                        </>
                      ) : (
                        t.label
                      )}{" "}
                      <span className="mono">{counts[t.id]}</span>
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
        </>
      )}

      {open && (
        <TopicDialog
          // A new key per card, so tapping a chip opens the other card with a clean slate.
          key={open.id}
          api={api}
          topic={open}
          topics={all}
          onOpenTopic={setOpenId}
          onClose={() => setOpenId(null)}
          onDeleted={(term) => say({ text: `Deleted "${term}"` })}
        />
      )}

      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
