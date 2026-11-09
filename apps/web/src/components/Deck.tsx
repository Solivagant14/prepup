/** The one main screen: capture, progress, filters and the card grid. */
import type { TopicView } from "@prepup/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
import type { Api } from "../lib/api.js";
import { matches, summarize, TABS, type Tab } from "../lib/deck.js";
import { TopicCard } from "./TopicCard.js";
import { TopicDialog } from "./TopicDialog.js";
import { Tracker } from "./Tracker.js";

export function Deck({ api, onSignOut }: { api: Api; onSignOut?: () => void }) {
  const qc = useQueryClient();
  const topics = useQuery({ queryKey: ["topics"], queryFn: api.listTopics });
  const [tab, setTab] = useState<Tab>("all");
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
  const shown = all.filter((t) => matches(tab, t));
  const summary = summarize(all);
  const counts: Record<Tab, number> = {
    all: summary.total,
    prep: summary.prep,
    fading_week: summary.fadingWeek,
    confident: summary.confident,
  };
  const open: TopicView | undefined = all.find((t) => t.id === openId);

  return (
    <div className="page">
      <header className="topbar">
        <span className="brand">PrepUp</span>
        <div className="topbar-right">
          <span>Test yourself in Claude · scores sync here</span>
          {onSignOut && (
            <button type="button" className="link-btn" onClick={onSignOut}>
              Sign out
            </button>
          )}
        </div>
      </header>

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

      <div className="toolbar">
        <div className="tabs" role="tablist" aria-label="Filter topics">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" className="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label} <span className="mono">{counts[t.id]}</span>
            </button>
          ))}
        </div>
        <span className="toolbar-note">The darker your deck, the more you know</span>
      </div>

      {topics.isLoading ? (
        <p className="muted">Loading your deck…</p>
      ) : topics.isError ? (
        <p className="error">{(topics.error as Error).message}</p>
      ) : shown.length === 0 ? (
        <p className="empty">
          {all.length === 0 ? "Your deck is empty. Add the first term you want to learn above." : "Nothing here right now."}
        </p>
      ) : (
        <div className="grid">
          {shown.map((t) => (
            <TopicCard key={t.id} topic={t} onOpen={() => setOpenId(t.id)} />
          ))}
        </div>
      )}

      {open && <TopicDialog api={api} topic={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
