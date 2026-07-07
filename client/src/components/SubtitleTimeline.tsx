import { useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';
import { seekVideo, useEditorStore } from '../lib/SubtitleStore';
import { clamp, formatTime } from '../lib/time';

const MIN_DURATION = 0.1;
const RULER_HEIGHT = 24;
const TICK_STEPS = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];

type DragMode = 'move' | 'resize-l' | 'resize-r';

interface DragState {
  id: string;
  mode: DragMode;
  pointerStart: number;
  origStart: number;
  origEnd: number;
  moved: boolean;
}

/**
 * Horizontal subtitle timeline. Cues are draggable blocks: dragging the body
 * shifts start+end, dragging an edge resizes, clicking selects (which opens
 * the cue in the editor panel). The playhead tracks video playback and the
 * ruler is click-to-seek.
 */
export function SubtitleTimeline() {
  const subtitles = useEditorStore((s) => s.subtitles);
  const selectedId = useEditorStore((s) => s.selectedId);
  const duration = useEditorStore((s) => s.videoMeta?.duration ?? 0);
  const updateSubtitle = useEditorStore((s) => s.updateSubtitle);
  const moveSubtitle = useEditorStore((s) => s.moveSubtitle);
  const selectSubtitle = useEditorStore((s) => s.selectSubtitle);
  const addSubtitleAt = useEditorStore((s) => s.addSubtitleAt);
  const splitSubtitle = useEditorStore((s) => s.splitSubtitle);
  const currentTime = useEditorStore((s) => s.currentTime);

  const [pxPerSec, setPxPerSec] = useState(80);
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);

  const totalWidth = Math.max(1, duration) * pxPerSec;

  const tickStep = useMemo(
    () => TICK_STEPS.find((s) => s * pxPerSec >= 70) ?? 600,
    [pxPerSec],
  );
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = 0; t <= duration; t += tickStep) out.push(t);
    return out;
  }, [duration, tickStep]);

  const timeAtPointer = (e: { clientX: number }): number => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return clamp((e.clientX - rect.left + el.scrollLeft) / pxPerSec, 0, duration);
  };

  const onBlockPointerDown = (
    e: React.PointerEvent,
    id: string,
    mode: DragMode,
    start: number,
    end: number,
  ) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      id,
      mode,
      pointerStart: e.clientX,
      origStart: start,
      origEnd: end,
      moved: false,
    };
  };

  const onBlockPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.pointerStart;
    if (Math.abs(dx) > 3) drag.moved = true;
    if (!drag.moved) return;
    const dt = dx / pxPerSec;
    if (drag.mode === 'move') {
      moveSubtitle(drag.id, clamp(drag.origStart + dt, 0, duration - (drag.origEnd - drag.origStart)));
    } else if (drag.mode === 'resize-l') {
      updateSubtitle(drag.id, {
        start: clamp(drag.origStart + dt, 0, drag.origEnd - MIN_DURATION),
      });
    } else {
      updateSubtitle(drag.id, {
        end: clamp(drag.origEnd + dt, drag.origStart + MIN_DURATION, duration),
      });
    }
  };

  const onBlockPointerUp = (_e: React.PointerEvent, id: string, start: number) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag && !drag.moved) {
      selectSubtitle(id);
      seekVideo(start + 0.001);
    }
  };

  // Ruler / empty-track scrubbing. Near the left/right edges the track keeps
  // auto-scrolling so the playhead can reach the very start or end of the video.
  const scrubbing = useRef(false);
  const scrubEdge = useRef(0); // -1 left edge, +1 right edge, 0 none
  const EDGE = 48;

  const edgeAt = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left + EDGE) return -1;
    if (clientX > rect.right - EDGE) return 1;
    return 0;
  };

  const onTrackPointerDown = (e: React.PointerEvent) => {
    scrubbing.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrubEdge.current = edgeAt(e.clientX);
    if (scrubEdge.current === 0) seekVideo(timeAtPointer(e));
  };
  const onTrackPointerMove = (e: React.PointerEvent) => {
    if (!scrubbing.current) return;
    scrubEdge.current = edgeAt(e.clientX);
    if (scrubEdge.current === 0) seekVideo(timeAtPointer(e));
  };
  const onTrackPointerUp = () => {
    scrubbing.current = false;
    scrubEdge.current = 0;
  };

  // While scrubbing at an edge, keep scrolling + seeking toward that end.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = scrollRef.current;
      const dir = scrubEdge.current;
      if (el && dir !== 0) {
        const max = Math.max(0, totalWidth - el.clientWidth);
        el.scrollLeft = clamp(el.scrollLeft + dir * 22, 0, max);
        const t = (dir > 0 ? el.scrollLeft + el.clientWidth : el.scrollLeft) / pxPerSec;
        seekVideo(clamp(t, 0, duration));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pxPerSec, duration, totalWidth]);

  // Keep the playhead visible while playing.
  const isPlaying = useEditorStore((s) => s.isPlaying);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isPlaying) return;
    const x = currentTime * pxPerSec;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 80) {
      el.scrollLeft = Math.max(0, x - 80);
    }
  }, [currentTime, isPlaying, pxPerSec]);

  if (!duration) return null;

  const selectedSub = subtitles.find((s) => s.id === selectedId);
  const canSplit = !!selectedSub && currentTime > selectedSub.start + MIN_DURATION && currentTime < selectedSub.end - MIN_DURATION;

  return (
    <div className="timeline">
      <div className="timeline__toolbar">
        <button
          className="btn btn--small"
          onClick={() => selectSubtitle(addSubtitleAt(useEditorStore.getState().currentTime).id)}
        >
          + Add at playhead
        </button>
        <button
          className="btn btn--small"
          disabled={!canSplit}
          onClick={() => selectedSub && splitSubtitle(selectedSub.id, currentTime)}
          title="Split the selected subtitle at the playhead (or double-click a block)"
        >
          ✂ Split at playhead
        </button>
        <div className="timeline__zoom">
          <button className="btn btn--icon" onClick={() => setPxPerSec((z) => Math.max(10, z / 1.4))} title="Zoom out">−</button>
          <span className="timeline__zoom-label">{Math.round(pxPerSec)} px/s</span>
          <button className="btn btn--icon" onClick={() => setPxPerSec((z) => Math.min(600, z * 1.4))} title="Zoom in">+</button>
        </div>
      </div>
      <div className="timeline__scroll" ref={scrollRef}>
        <div
          className="timeline__canvas"
          style={{ width: totalWidth }}
          onPointerDown={onTrackPointerDown}
          onPointerMove={onTrackPointerMove}
          onPointerUp={onTrackPointerUp}
        >
          <div className="timeline__ruler" style={{ height: RULER_HEIGHT }}>
            {ticks.map((t) => (
              <span key={t} className="timeline__tick" style={{ left: t * pxPerSec }}>
                {formatTime(t)}
              </span>
            ))}
          </div>
          <div className="timeline__track">
            {subtitles.map((sub) => (
              <div
                key={sub.id}
                className={`timeline__block${sub.id === selectedId ? ' is-selected' : ''}${sub.styleOverride ? ' has-style' : ''}`}
                style={{ left: sub.start * pxPerSec, width: Math.max(6, (sub.end - sub.start) * pxPerSec) }}
                onPointerDown={(e) => onBlockPointerDown(e, sub.id, 'move', sub.start, sub.end)}
                onPointerMove={onBlockPointerMove}
                onPointerUp={(e) => onBlockPointerUp(e, sub.id, sub.start)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  splitSubtitle(sub.id, timeAtPointer(e));
                }}
                title={`${sub.text}\n\nDouble-click to split`}
              >
                <span
                  className="timeline__handle timeline__handle--l"
                  onPointerDown={(e) => onBlockPointerDown(e, sub.id, 'resize-l', sub.start, sub.end)}
                  onPointerMove={onBlockPointerMove}
                  onPointerUp={(e) => onBlockPointerUp(e, sub.id, sub.start)}
                />
                <span className="timeline__block-text">{sub.text}</span>
                <span
                  className="timeline__handle timeline__handle--r"
                  onPointerDown={(e) => onBlockPointerDown(e, sub.id, 'resize-r', sub.start, sub.end)}
                  onPointerMove={onBlockPointerMove}
                  onPointerUp={(e) => onBlockPointerUp(e, sub.id, sub.start)}
                />
              </div>
            ))}
            <Playhead pxPerSec={pxPerSec} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Isolated so the 60fps clock only re-renders the playhead line. */
function Playhead({ pxPerSec }: { pxPerSec: number }) {
  const currentTime = useEditorStore((s) => s.currentTime);
  return <div className="timeline__playhead" style={{ left: currentTime * pxPerSec }} />;
}
