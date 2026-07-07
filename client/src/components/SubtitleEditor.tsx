import { useEffect, useRef, useState } from 'react';
import { seekVideo, useEditorStore } from '../lib/SubtitleStore';
import { BUILTIN_PRESETS } from '../lib/presets';
import { formatTimecode, parseTimecode } from '../lib/time';
import type { Subtitle } from '../types/Subtitle';
import { ServerInbox } from './ServerInbox';

/**
 * Subtitle list + inline cue editor. Selecting a cue (here or on the
 * timeline) expands it for editing start / end / duration / text.
 */
export function SubtitleEditor() {
  const subtitles = useEditorStore((s) => s.subtitles);
  const selectedId = useEditorStore((s) => s.selectedId);
  const selectSubtitle = useEditorStore((s) => s.selectSubtitle);
  const addSubtitleAt = useEditorStore((s) => s.addSubtitleAt);

  const listRef = useRef<HTMLDivElement>(null);

  // Keep the selected cue scrolled into view when selection comes from the timeline.
  useEffect(() => {
    if (!selectedId) return;
    listRef.current
      ?.querySelector(`[data-cue="${selectedId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  if (subtitles.length === 0) {
    return (
      <div className="panel-empty">
        <p>No subtitles yet.</p>
        <p>Upload an SRT file or create cues manually.</p>
        <button
          className="btn btn--primary"
          onClick={() => addSubtitleAt(useEditorStore.getState().currentTime)}
        >
          + Create first subtitle
        </button>
        <ServerInbox kinds={['subtitle']} />
      </div>
    );
  }

  return (
    <div className="sub-list" ref={listRef}>
      {subtitles.map((sub, i) => (
        <SubtitleRow
          key={sub.id}
          sub={sub}
          index={i}
          expanded={sub.id === selectedId}
          onSelect={() => {
            selectSubtitle(sub.id);
            seekVideo(sub.start + 0.001);
          }}
        />
      ))}
      <button
        className="btn btn--ghost sub-list__add"
        onClick={() => addSubtitleAt(useEditorStore.getState().currentTime)}
      >
        + Add subtitle at playhead
      </button>
    </div>
  );
}

function SubtitleRow({
  sub,
  index,
  expanded,
  onSelect,
}: {
  sub: Subtitle;
  index: number;
  expanded: boolean;
  onSelect: () => void;
}) {
  const updateSubtitle = useEditorStore((s) => s.updateSubtitle);
  const deleteSubtitle = useEditorStore((s) => s.deleteSubtitle);
  const duration = sub.end - sub.start;

  if (!expanded) {
    return (
      <div className="sub-row" data-cue={sub.id} onClick={onSelect}>
        <span className="sub-row__index">{index + 1}</span>
        <span className="sub-row__time">
          {formatTimecode(sub.start)} → {formatTimecode(sub.end)}
        </span>
        <span className="sub-row__text">{sub.text}</span>
        {sub.styleOverride && (
          <span className="sub-row__preset" title={`Own style from here: ${sub.presetName ?? 'custom'}`}>
            ◆ {sub.presetName ?? 'style'}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="sub-row sub-row--expanded" data-cue={sub.id}>
      <div className="sub-row__fields">
        <TimeField
          label="Start"
          value={sub.start}
          onCommit={(t) => updateSubtitle(sub.id, { start: Math.min(t, sub.end - 0.1) })}
        />
        <TimeField
          label="End"
          value={sub.end}
          onCommit={(t) => updateSubtitle(sub.id, { end: Math.max(t, sub.start + 0.1) })}
        />
        <TimeField
          label="Duration"
          value={duration}
          onCommit={(d) => updateSubtitle(sub.id, { end: sub.start + Math.max(0.1, d) })}
        />
      </div>
      <textarea
        className="sub-row__textarea"
        value={sub.text}
        rows={5}
        placeholder="Subtitle text…"
        onChange={(e) => updateSubtitle(sub.id, { text: e.target.value })}
        autoFocus
      />
      <div className="sub-row__actions">
        <CuePresetPicker sub={sub} />
        <span className="modal__spacer" />
        <button className="btn btn--small btn--danger" onClick={() => deleteSubtitle(sub.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

/**
 * Per-cue preset: a cue with its own preset starts a style segment that the
 * following cues inherit until the next styled cue ("Inherited").
 */
function CuePresetPicker({ sub }: { sub: Subtitle }) {
  const customPresets = useEditorStore((s) => s.customPresets);
  const applyPresetToCue = useEditorStore((s) => s.applyPresetToCue);
  const clearCueStyle = useEditorStore((s) => s.clearCueStyle);
  const presets = [...BUILTIN_PRESETS, ...customPresets];

  return (
    <label className="field sub-row__preset-field" title="Style used from this subtitle onward">
      <span className="field__label">Style from here</span>
      <select
        className="field__input"
        value={sub.styleOverride ? (sub.presetName ?? '__custom') : ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v === '') clearCueStyle(sub.id);
          else {
            const p = presets.find((x) => x.name === v);
            if (p) applyPresetToCue(sub.id, p);
          }
        }}
      >
        <option value="">Inherited</option>
        {sub.styleOverride && !sub.presetName && <option value="__custom">Custom</option>}
        {presets.map((p) => (
          <option key={p.id} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Timecode input with draft state: edits commit on blur / Enter, and
 * invalid input reverts to the last valid value.
 */
function TimeField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (t: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const t = parseTimecode(draft);
    if (t !== null) onCommit(t);
    setDraft(null);
  };

  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        className="field__input field__input--time"
        value={draft ?? formatTimecode(value)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(null);
        }}
        spellCheck={false}
      />
    </label>
  );
}
