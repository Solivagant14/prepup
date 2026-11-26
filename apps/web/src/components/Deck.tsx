/** The one main screen: decks, capture, progress, filters and the card grid. */
import type { TopicView } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState, type FormEvent } from "react";
import type { Api } from "../lib/api.js";
import {
  ALL_DECKS,
  inDeck,
  linkPairs,
  linkPrompt,
  shownIn,
  startSteps,
  studyOrder,
  summarize,
  TABS,
  type DeckChoice,
  type Tab,
} from "../lib/deck.js";
import { DeckBar } from "./DeckBar.js";
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

const DECK_KEY = "prepup.deck";

/** Which deck was open last time, on this device. */
function savedDeck(): DeckChoice {
  try {
    return localStorage.getItem(DECK_KEY) ?? ALL_DECKS;
  } catch {
    return ALL_DECKS;
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
  const decksQuery = useQuery({ queryKey: ["decks"], queryFn: api.listDecks });
  const decks = decksQuery.data ?? [];
  const [picked, setPicked] = useState<DeckChoice>(savedDeck);
  // A deck deleted elsewhere (say, by an assistant) falls back to every deck.
  const deck: DeckChoice = picked === ALL_DECKS || decks.some((d) => d.id === picked) || !decksQuery.isSuccess ? picked : ALL_DECKS;
  const pickDeck = (next: DeckChoice) => {
    setPicked(next);
    try {
      localStorage.setItem(DECK_KEY, next);
    } catch {
      // Without storage the choice lasts until the page reloads.
    }
  };
  /** Where a new topic goes from the "All decks" view when there are several decks. */
  const [addTo, setAddTo] = useState("");
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
  const reload = () => {
    void qc.invalidateQueries({ queryKey: ["topics"] });
    void qc.invalidateQueries({ queryKey: ["decks"] });
  };

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
          : { text: `"${topic.term}" is already in "${topic.deck.name}"`, action: { label: "Open", run: () => { setOpenId(topic.id); setToast(null); } } },
      );
      reload();
    },
    onError: (e: Error, { term }) => {
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
    const deckId = deck !== ALL_DECKS ? deck : decks.length === 1 ? decks[0]!.id : addTo;
    if (decks.length > 1 && !deckId) return say({ text: "Pick a deck to add it to", error: true });
    setDraft("");
    add.mutate({ term, ...(deckId ? { deckId } : {}) });
  };
  const hide = () => {
    setHideStart(true);
    try {
      localStorage.setItem(START_KEY, "1");
    } catch {
      // Without storage the steps come back next visit; hiding still works for now.
    }
  };

  const everything = topics.data ?? [];
  const all = inDeck(deck, everything);
  const shown = shownIn(tab, all);
  const deckName = decks.find((d) => d.id === deck)?.name;
  const showDeckOnCards = deck === ALL_DECKS && decks.length > 1;
  const chooseDeck = deck === ALL_DECKS && decks.length > 1;
  const summary = summarize(all);
  const counts: Record<Tab, number> = {
    all: summary.total,
    prep: summary.prep,
    fading_week: summary.fadingWeek,
    confident: summary.confident,
  };
  const linkCount = linkPairs(all).length;
  const unchecked = all.filter((t) => t.needsLinks).length;
  const order = linkCount > 0 ? studyOrder(all) : [];
  const copyLinkPrompt = async () => {
    try {
      await navigator.clipboard.writeText(linkPrompt(deckName));
      say({ text: "Copied. Paste it into a chat with your assistant." });
    } catch {
      say({ text: `Couldn't copy. Ask your assistant: ${linkPrompt(deckName)}`, error: true });
    }
  };
  const open: TopicView | undefined = everything.find((t) => t.id === openId);
  const steps = topics.isSuccess && !hideStart ? startSteps(everything) : null;
  const empty = topics.isSuccess && all.length === 0;

  return (
    <div className="page">
      {decksQuery.isSuccess && (
        <DeckBar
          api={api}
          decks={decks}
          total={everything.length}
          selected={deck}
          onSelect={(next) => {
            pickDeck(next);
            setTab("all");
          }}
          onMessage={(text, error) => say({ text, error })}
        />
      )}

      <form className="capture" onSubmit={capture}>
        <label htmlFor="capture" className="sr-only">
          Add a term
        </label>
        <input
          id="capture"
          ref={input}
          autoComplete="off"
          enterKeyHint="done"
          placeholder={deckName ? `Add a term to ${deckName}…` : "Add a term you just heard…"}
          value={draft}
          maxLength={80}
          onChange={(e) => setDraft(e.target.value)}
        />
        {chooseDeck && (
          <>
            <label htmlFor="capture-deck" className="sr-only">
              Deck to add it to
            </label>
            <select id="capture-deck" value={addTo} onChange={(e) => setAddTo(e.target.value)}>
              <option value="">Choose a deck</option>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </>
        )}
        <button type="submit" className="btn primary" disabled={add.isPending}>
          {add.isPending ? "Adding…" : "Add"}
        </button>
      </form>

      {steps && <GetStarted steps={steps} onHide={hide} />}

      {empty ? (
        !steps && (
          <p className="empty">
            {deckName ? `"${deckName}" is empty. Add the first term for it above.` : "Your deck is empty. Add the first term you want to learn above."}
          </p>
        )
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
        <div className="graph-head">
          <p className="tab-hint view-hint">
            {linkCount === 0
              ? "No links yet. Press Link topics and paste the request into a chat with your assistant, or open a card and add what it builds on."
              : "Arrows run from a topic to what builds on it, so each path reads left to right."}{" "}
            Drag to move, pinch or Ctrl + scroll to zoom, tap a topic to open it.
            {unchecked > 0 && all.length > 1 && (
              <> {unchecked === 1 ? "1 topic hasn't" : `${unchecked} topics haven't`} been checked for links yet.</>
            )}
          </p>
          {all.length > 1 && (
            <button type="button" className="btn primary" onClick={() => void copyLinkPrompt()}>
              Link topics
            </button>
          )}
        </div>
      )}

      <div id="deck-view" role="tabpanel" aria-labelledby={`view-${view}`}>
        {topics.isLoading ? (
          <p className="muted">Loading your deck…</p>
        ) : topics.isError ? (
          <p className="error">{(topics.error as Error).message}</p>
        ) : view === "graph" ? (
          <>
            <GraphBoard topics={all} onOpen={setOpenId} />
            {order.length > 0 && (
              <section className="study-order" aria-labelledby="study-title">
                <h2 id="study-title">Where to start</h2>
                <p className="note">The order to learn {deckName ? `“${deckName}”` : "these topics"} in: each topic comes after what it builds on.</p>
                <ol>
                  {order.map((t) => (
                    <li key={t.id}>
                      <button type="button" className="link-btn" onClick={() => setOpenId(t.id)}>
                        {t.term}
                      </button>
                      <span className="small">
                        {t.level}
                        {showDeckOnCards ? ` · ${t.deck.name}` : ""}
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            )}
          </>
        ) : shown.length === 0 ? (
          <p className="empty">Nothing here right now.</p>
        ) : (
          <div className="grid">
            {shown.map((t) => (
              <TopicCard key={t.id} topic={t} showDeck={showDeckOnCards} onOpen={() => setOpenId(t.id)} />
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
          // Links stay inside one deck, so the prerequisite search looks only there.
          topics={everything.filter((t) => t.deck.id === open.deck.id)}
          decks={decks}
          onOpenTopic={setOpenId}
          onClose={() => setOpenId(null)}
          onDeleted={(term) => say({ text: `Deleted "${term}"` })}
        />
      )}

      <Toast toast={toast} onDone={clearToast} />
    </div>
  );
}
