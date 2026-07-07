import { useState } from 'react';
import { useEditorStore } from '../lib/SubtitleStore';
import { BUILTIN_PRESETS } from '../lib/presets';
import type { StylePreset } from '../types/Style';

/**
 * Preset gallery: built-in looks inspired by modern editors plus
 * user-created presets persisted in localStorage.
 */
export function PresetSelector() {
  const customPresets = useEditorStore((s) => s.customPresets);
  const applyPreset = useEditorStore((s) => s.applyPreset);
  const applyPresetToCue = useEditorStore((s) => s.applyPresetToCue);
  const saveCustomPreset = useEditorStore((s) => s.saveCustomPreset);
  const deleteCustomPreset = useEditorStore((s) => s.deleteCustomPreset);
  const selected = useEditorStore((s) => s.subtitles.find((x) => x.id === s.selectedId) ?? null);

  const [name, setName] = useState('');
  const [target, setTarget] = useState<'all' | 'cue'>('all');
  const applyTo = target === 'cue' && selected ? selected : null;

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    saveCustomPreset(trimmed);
    setName('');
  };

  const apply = (p: StylePreset) => {
    if (applyTo) applyPresetToCue(applyTo.id, p);
    else applyPreset(p);
  };

  return (
    <div className="presets">
      {selected && (
        <div className="presets__target">
          <span className="field__label">Apply to</span>
          <div className="btn-group">
            <button
              className={`btn btn--small btn--toggle${target === 'all' ? ' is-active' : ''}`}
              onClick={() => setTarget('all')}
            >
              Base style
            </button>
            <button
              className={`btn btn--small btn--toggle${target === 'cue' ? ' is-active' : ''}`}
              onClick={() => setTarget('cue')}
              title={selected.text}
            >
              Selected cue onward
            </button>
          </div>
        </div>
      )}
      <div className="presets__grid">
        {BUILTIN_PRESETS.map((p) => (
          <PresetCard key={p.id} preset={p} onApply={() => apply(p)} />
        ))}
        {customPresets.map((p) => (
          <PresetCard
            key={p.id}
            preset={p}
            onApply={() => apply(p)}
            onDelete={() => deleteCustomPreset(p.id)}
          />
        ))}
      </div>
      <div className="presets__save">
        <input
          className="field__input"
          placeholder="Preset name…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="btn btn--primary btn--small" onClick={save} disabled={!name.trim()}>
          Save current style
        </button>
      </div>
    </div>
  );
}

function PresetCard({
  preset,
  onApply,
  onDelete,
}: {
  preset: StylePreset;
  onApply: () => void;
  onDelete?: () => void;
}) {
  const s = preset.style;
  const boxed = s.background || s.captionBox;
  // Downscaled inline approximation of the style, just for the gallery chip.
  const k = 0.5;
  return (
    <button className="preset-card" onClick={onApply} title={`Apply “${preset.name}”`}>
      <span
        className="preset-card__sample"
        style={{
          fontFamily: s.fontFamily,
          fontWeight: s.bold ? 700 : 400,
          fontStyle: s.italic ? 'italic' : 'normal',
          color: s.color,
          letterSpacing: s.letterSpacing * k,
          WebkitTextStroke: !boxed && s.outlineWidth > 0 ? `${Math.min(2, s.outlineWidth * k)}px ${s.outlineColor}` : undefined,
          textShadow:
            !s.background && s.shadow
              ? `${s.shadowOffsetX * k}px ${s.shadowOffsetY * k}px ${s.shadowBlur * k}px ${s.shadowColor}`
              : undefined,
          background: boxed
            ? `${s.backgroundColor}${Math.round(s.backgroundOpacity * 255).toString(16).padStart(2, '0')}`
            : undefined,
          borderRadius: boxed ? s.borderRadius * k : undefined,
          padding: boxed ? '2px 10px' : '2px 0',
        }}
      >
        Aa
      </span>
      <span className="preset-card__name">{preset.name}</span>
      {onDelete && (
        <span
          className="preset-card__delete"
          title="Delete preset"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          ×
        </span>
      )}
    </button>
  );
}
