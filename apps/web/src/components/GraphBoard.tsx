/**
 * The graph view: the deck as a board you can move around. Drag (or scroll)
 * to pan in any direction, pinch or Ctrl+scroll to zoom, tap a topic to open
 * its card. Links are made and removed in the card, not here, so nothing
 * changes by accident while moving the board.
 */
import type { TopicView } from "@prepup/contracts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { cardLook } from "../lib/deck.js";
import {
  fitView,
  keepInReach,
  layoutGraph,
  MAX_ZOOM,
  MIN_ZOOM,
  NODE_H,
  NODE_W,
  openingView,
  zoomAt,
  type View,
} from "../lib/graph.js";

/** A press that travels less than this is a tap, not a drag. */
const TAP_SLOP = 5;

export function GraphBoard({ topics, onOpen }: { topics: TopicView[]; onOpen: (id: string) => void }) {
  const layout = useMemo(() => layoutGraph(topics), [topics]);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Once the user has moved the board, it stays where they put it. */
  const touched = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);
  const latest = useRef({ layout, view });
  latest.current = { layout, view };

  const size = () => {
    const r = box.current!.getBoundingClientRect();
    return { width: r.width, height: r.height, left: r.left, top: r.top };
  };
  const change = (next: (v: View) => View) => {
    touched.current = true;
    setView((v) => (v ? keepInReach(next(v), latest.current.layout, size()) : v));
  };
  /** Fit always shows everything, however small that makes it. */
  const fit = () => {
    touched.current = true;
    setView(fitView(latest.current.layout, size()));
  };

  // Open on a sensible view, and keep doing so through resizes and new topics until the user moves the board.
  useLayoutEffect(() => {
    if (!touched.current) setView(openingView(layout, size()));
  }, [layout]);
  useEffect(() => {
    const el = box.current!;
    const observer = new ResizeObserver(() => {
      if (!touched.current) setView(openingView(latest.current.layout, size()));
    });
    observer.observe(el);
    // React's wheel listener is passive, and this one must stop the page from scrolling or zooming instead.
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { left, top } = size();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        change((v) => zoomAt(v, Math.exp(-e.deltaY * unit * 0.01), e.clientX - left, e.clientY - top));
      } else {
        const [dx, dy] = e.shiftKey && e.deltaX === 0 ? [e.deltaY, 0] : [e.deltaX, e.deltaY];
        change((v) => ({ ...v, x: v.x - dx * unit, y: v.y - dy * unit }));
      }
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".board-controls")) return;
    if (pointers.current.size === 0) moved.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const before = pointers.current.get(e.pointerId);
    if (!before) return;
    const now = { x: e.clientX, y: e.clientY };
    if (!moved.current) {
      if (pointers.current.size === 1 && Math.hypot(now.x - before.x, now.y - before.y) < TAP_SLOP) return;
      // It's a drag: take the pointer, so the topic underneath doesn't get a click when it ends.
      moved.current = true;
      setDragging(true);
      for (const id of pointers.current.keys()) box.current!.setPointerCapture(id);
    }
    const { left, top } = size();
    if (pointers.current.size === 1) {
      change((v) => ({ ...v, x: v.x + now.x - before.x, y: v.y + now.y - before.y }));
    } else {
      // Two fingers: zoom by how far apart they moved, and pan by how far their midpoint moved.
      const other = [...pointers.current.entries()].find(([id]) => id !== e.pointerId)![1];
      const mid = (p: { x: number; y: number }) => ({ x: (p.x + other.x) / 2 - left, y: (p.y + other.y) / 2 - top });
      const spread = (p: { x: number; y: number }) => Math.max(1, Math.hypot(p.x - other.x, p.y - other.y));
      const [from, to] = [mid(before), mid(now)];
      change((v) => {
        const zoomed = zoomAt(v, spread(now) / spread(before), from.x, from.y);
        return { ...zoomed, x: zoomed.x + to.x - from.x, y: zoomed.y + to.y - from.y };
      });
    }
    pointers.current.set(e.pointerId, now);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  const zoomButton = (factor: number) => {
    const { width, height } = size();
    change((v) => zoomAt(v, factor, width / 2, height / 2));
  };
  /** A topic reached with the keyboard is brought into view. */
  const reveal = (x: number, y: number) => {
    const v = latest.current.view;
    if (!v) return;
    const { width, height } = size();
    const pad = 16;
    const [l, t, r, b] = [v.x + x * v.k, v.y + y * v.k, v.x + (x + NODE_W) * v.k, v.y + (y + NODE_H) * v.k];
    const dx = l < pad ? pad - l : r > width - pad ? width - pad - r : 0;
    const dy = t < pad ? pad - t : b > height - pad ? height - pad - b : 0;
    if (dx || dy) change((cur) => ({ ...cur, x: cur.x + dx, y: cur.y + dy }));
  };

  // The topic under the pointer (or focused) and its direct neighbours stand out; the rest steps back.
  const near = useMemo(() => {
    if (!active) return null;
    const ids = new Set([active]);
    for (const e of layout.edges) {
      if (e.from === active) ids.add(e.to);
      if (e.to === active) ids.add(e.from);
    }
    return ids;
  }, [active, layout]);

  const k = view?.k ?? 1;
  const grid = 24 * k;
  return (
    <div
      ref={box}
      className={`board${dragging ? " dragging" : ""}`}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view?.x ?? 0}px ${view?.y ?? 0}px` }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    >
      <div
        className="board-plane"
        style={{
          width: layout.width,
          height: layout.height,
          transform: `translate(${view?.x ?? 0}px, ${view?.y ?? 0}px) scale(${k})`,
          visibility: view ? "visible" : "hidden",
        }}
      >
        <svg className="board-edges" width={layout.width} height={layout.height} aria-hidden="true">
          <defs>
            {/* Two arrowheads, since a marker can't reliably take its line's colour in every browser. */}
            {(["arrow", "arrow-on"] as const).map((id) => (
              <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M1,1 L9,5 L1,9" className={id} />
              </marker>
            ))}
          </defs>
          {layout.edges.map((e) => {
            const on = active !== null && (e.from === active || e.to === active);
            return (
              <path
                key={`${e.from}>${e.to}`}
                d={e.path}
                className={on ? "on" : active ? "off" : undefined}
                markerEnd={on ? "url(#arrow-on)" : "url(#arrow)"}
              />
            );
          })}
        </svg>
        {layout.unlinkedLabel && (
          <span className="board-label" style={{ left: layout.unlinkedLabel.x, top: layout.unlinkedLabel.y }}>
            Not linked yet <span className="mono">{layout.unlinkedLabel.count}</span>
          </span>
        )}
        {layout.nodes.map(({ topic, x, y }) => {
          const look = cardLook(topic);
          const links = [
            topic.buildsOn.length ? `builds on ${topic.buildsOn.map((t) => t.term).join(", ")}` : "",
            topic.neededFor.length ? `needed for ${topic.neededFor.map((t) => t.term).join(", ")}` : "",
          ].filter(Boolean);
          return (
            <button
              key={topic.id}
              type="button"
              className={`node${near && !near.has(topic.id) ? " off" : ""}${active === topic.id ? " on" : ""}`}
              style={{ left: x, top: y, width: NODE_W, height: NODE_H, background: look.background, borderColor: look.border, color: look.ink }}
              aria-label={[`${topic.term}, ${topic.level}, ${topic.score} of 5`, ...links].join("; ")}
              title={topic.term}
              onClick={() => !moved.current && onOpen(topic.id)}
              onPointerEnter={(e) => e.pointerType === "mouse" && setActive(topic.id)}
              onPointerLeave={() => setActive(null)}
              onFocus={(e) => {
                setActive(topic.id);
                if (e.currentTarget.matches(":focus-visible")) reveal(x, y);
              }}
              onBlur={() => setActive(null)}
            >
              <span className="node-term">{topic.term}</span>
              <span className="node-meta">
                <span>{topic.fadingSoon ? `fades in ${topic.daysUntilDrop}d` : topic.level}</span>
                <span className="mono">{topic.score}/5</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="board-controls" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" disabled={k <= MIN_ZOOM} onClick={() => zoomButton(1 / 1.25)}>
          −
        </button>
        <span className="mono" aria-live="polite">
          {Math.round(k * 100)}%
        </span>
        <button type="button" aria-label="Zoom in" disabled={k >= MAX_ZOOM} onClick={() => zoomButton(1.25)}>
          +
        </button>
        <button type="button" className="fit" onClick={fit}>
          Fit
        </button>
      </div>
    </div>
  );
}
