import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useEditorStore } from '../lib/SubtitleStore';
import { loadFonts, type FontInfo } from '../lib/fonts';
import { resolveCueStyles } from '../types/Subtitle';
import type { SubtitleStyle, SubtitleAlignment } from '../types/Style';

/**
 * Full styling controls. By default edits target the SELECTED cue's style
 * segment ("selected cue onward") so a change sticks to that cue and the ones
 * inheriting from it; toggle to "Base style" to edit the global default.
 * Every change re-renders only the Konva subtitle layer — the same values
 * feed the ASS generator, so what you tweak here is what FFmpeg burns in.
 */
export function StylePanel() {
  const baseStyle = useEditorStore((s) => s.style);
  const subtitles = useEditorStore((s) => s.subtitles);
  const selectedId = useEditorStore((s) => s.selectedId);
  const updateStyleBase = useEditorStore((s) => s.updateStyle);
  const updateStyleAt = useEditorStore((s) => s.updateStyleAt);

  const [target, setTarget] = useState<'base' | 'cue'>('cue');
  const cueMode = target === 'cue' && selectedId != null;
  const effectiveMap = useMemo(
    () => resolveCueStyles(subtitles, baseStyle),
    [subtitles, baseStyle],
  );
  // The style the controls show + edit: the selected cue's effective style,
  // or the base style when no cue is selected (or "Base style" is picked).
  const style: SubtitleStyle = cueMode ? effectiveMap.get(selectedId!) ?? baseStyle : baseStyle;
  const updateStyle = (patch: Partial<SubtitleStyle>) => {
    if (cueMode) updateStyleAt(selectedId!, patch);
    else updateStyleBase(patch);
  };
  const selectedIndex = selectedId ? subtitles.findIndex((s) => s.id === selectedId) : -1;
  // The inline (text-hugging) background; superseded by caption box mode.
  const inlineBackground = style.background && !style.captionBox;

  const [fonts, setFonts] = useState<FontInfo[]>([]);
  useEffect(() => {
    void loadFonts().then(setFonts);
  }, []);

  return (
    <div className="style-panel">
      <div className="style-panel__scope">
        <div className="btn-group">
          <button
            className={`btn btn--small btn--toggle${!cueMode ? ' is-active' : ''}`}
            onClick={() => setTarget('base')}
          >
            Base style
          </button>
          <button
            className={`btn btn--small btn--toggle${cueMode ? ' is-active' : ''}`}
            disabled={!selectedId}
            onClick={() => setTarget('cue')}
            title={selectedId ? 'Apply edits from the selected cue onward' : 'Select a cue first'}
          >
            Selected cue onward
          </button>
        </div>
        <span className="style-panel__scope-hint">
          {cueMode
            ? `Editing cue #${selectedIndex + 1} — applies from here onward`
            : 'Editing the base style (every cue)'}
        </span>
      </div>
      <Section title="Font">
        <label className="field field--wide">
          <span className="field__label">Family</span>
          <select
            className="field__input"
            value={style.fontFamily}
            onChange={(e) => updateStyle({ fontFamily: e.target.value })}
          >
            {fonts.map((f) => (
              <option key={f.family} value={f.family} style={{ fontFamily: f.family }}>
                {f.family}
              </option>
            ))}
            {!fonts.some((f) => f.family === style.fontFamily) && (
              <option value={style.fontFamily}>{style.fontFamily}</option>
            )}
          </select>
        </label>
        <NumberField
          label={style.captionBox ? 'Max size (auto-fits)' : 'Size'}
          value={style.fontSize}
          min={8}
          max={300}
          onChange={(fontSize) => updateStyle({ fontSize })}
        />
        <div className="field">
          <span className="field__label">Format</span>
          <div className="btn-group">
            <Toggle active={style.bold} label="B" title="Bold" onClick={() => updateStyle({ bold: !style.bold })} strong />
            <Toggle active={style.italic} label="I" title="Italic" onClick={() => updateStyle({ italic: !style.italic })} em />
            <Toggle active={style.underline} label="U" title="Underline" onClick={() => updateStyle({ underline: !style.underline })} u />
          </div>
        </div>
        <NumberField label="Letter spacing" value={style.letterSpacing} min={-10} max={50} onChange={(letterSpacing) => updateStyle({ letterSpacing })} />
        <NumberField label="Line spacing" value={style.lineSpacing} min={0.7} max={3} step={0.05} hint="preview only" onChange={(lineSpacing) => updateStyle({ lineSpacing })} />
      </Section>

      <Section title="Colors">
        <ColorField label="Text" value={style.color} onChange={(color) => updateStyle({ color })} />
        <SliderField label="Opacity" value={style.opacity} min={0.05} max={1} step={0.05} onChange={(opacity) => updateStyle({ opacity })} />
        <ColorField label="Outline" value={style.outlineColor} onChange={(outlineColor) => updateStyle({ outlineColor })} disabled={inlineBackground} />
        <NumberField label="Outline width" value={style.outlineWidth} min={0} max={20} step={0.5} onChange={(outlineWidth) => updateStyle({ outlineWidth })} disabled={inlineBackground} />
      </Section>

      <Section
        title="Caption box"
        toggle={{ on: style.captionBox, set: (captionBox) => updateStyle({ captionBox }) }}
      >
        {style.captionBox && (
          <>
            <ColorField label="Box color" value={style.backgroundColor} onChange={(backgroundColor) => updateStyle({ backgroundColor })} />
            <SliderField label="Box opacity" value={style.backgroundOpacity} min={0} max={1} step={0.05} onChange={(backgroundOpacity) => updateStyle({ backgroundOpacity })} />
            <NumberField label="Corner radius" value={style.borderRadius} min={0} max={120} onChange={(borderRadius) => updateStyle({ borderRadius })} />
            <NumberField label="Fade in/out (ms)" value={style.fadeMs} min={0} max={1000} step={50} onChange={(fadeMs) => updateStyle({ fadeMs })} />
            <p className="style-panel__hint field--wide">
              Drag the box on the video to place it; pull the handles to resize.
              Text auto-shrinks to fit.
            </p>
          </>
        )}
      </Section>

      <Section
        title="Shadow"
        toggle={{ on: style.shadow, set: (shadow) => updateStyle({ shadow }) }}
        disabled={inlineBackground}
        disabledHint="unavailable with background box"
      >
        {style.shadow && !inlineBackground && (
          <>
            <ColorField label="Color" value={style.shadowColor} onChange={(shadowColor) => updateStyle({ shadowColor })} />
            <NumberField label="Blur" value={style.shadowBlur} min={0} max={60} onChange={(shadowBlur) => updateStyle({ shadowBlur })} />
            <NumberField label="Offset X" value={style.shadowOffsetX} min={-40} max={40} onChange={(shadowOffsetX) => updateStyle({ shadowOffsetX })} />
            <NumberField label="Offset Y" value={style.shadowOffsetY} min={-40} max={40} onChange={(shadowOffsetY) => updateStyle({ shadowOffsetY })} />
          </>
        )}
      </Section>

      <Section
        title="Position"
        disabled={style.captionBox}
        disabledHint="the caption box sets the position"
      >
        <div className="field field--wide">
          <span className="field__label">Alignment</span>
          <div className="btn-group">
            {(['top', 'center', 'bottom'] as SubtitleAlignment[]).map((a) => (
              <Toggle
                key={a}
                active={style.alignment === a && !style.position}
                label={a[0].toUpperCase() + a.slice(1)}
                onClick={() => updateStyle({ alignment: a, position: null })}
              />
            ))}
          </div>
        </div>
        {style.alignment === 'bottom' && !style.position && (
          <NumberField label="Bottom margin" value={style.marginBottom} min={0} max={600} onChange={(marginBottom) => updateStyle({ marginBottom })} />
        )}
        {style.alignment === 'top' && !style.position && (
          <NumberField label="Top margin" value={style.marginTop} min={0} max={600} onChange={(marginTop) => updateStyle({ marginTop })} />
        )}
        {style.position ? (
          <div className="field field--wide">
            <span className="field__label">
              Free position ({Math.round(style.position.x * 100)}%, {Math.round(style.position.y * 100)}%)
            </span>
            <button className="btn btn--small" onClick={() => updateStyle({ position: null })}>
              Reset to alignment
            </button>
          </div>
        ) : (
          <p className="style-panel__hint">Tip: drag the subtitle on the video to position it freely.</p>
        )}
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
  toggle,
  disabled,
  disabledHint,
}: {
  title: string;
  children?: React.ReactNode;
  toggle?: { on: boolean; set: (v: boolean) => void };
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <section className={`style-section${disabled ? ' is-disabled' : ''}`}>
      <header className="style-section__header">
        <h3>{title}</h3>
        {toggle && (
          <input
            type="checkbox"
            checked={toggle.on}
            disabled={disabled}
            onChange={(e) => toggle.set(e.target.checked)}
          />
        )}
        {disabled && disabledHint && <span className="style-section__hint">{disabledHint}</span>}
      </header>
      {!disabled && <div className="style-section__body">{children}</div>}
    </section>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  hint,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`field${disabled ? ' is-disabled' : ''}`}>
      <span className="field__label">
        {label}
        {hint && <em className="field__hint"> ({hint})</em>}
      </span>
      <input
        type="number"
        className="field__input"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
        }}
      />
    </label>
  );
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
}) {
  return (
    <label className="field">
      <span className="field__label">
        {label} <em className="field__hint">{Math.round(value * 100)}%</em>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`field${disabled ? ' is-disabled' : ''}`}>
      <span className="field__label">{label}</span>
      <input
        type="color"
        className="field__color"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

function Toggle({
  active,
  label,
  onClick,
  title,
  strong,
  em,
  u,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
  title?: string;
  strong?: boolean;
  em?: boolean;
  u?: boolean;
}) {
  let content: React.ReactNode = label;
  if (strong) content = <strong>{label}</strong>;
  else if (em) content = <em>{label}</em>;
  else if (u) content = <u>{label}</u>;
  return (
    <button className={`btn btn--toggle${active ? ' is-active' : ''}`} onClick={onClick} title={title}>
      {content}
    </button>
  );
}
