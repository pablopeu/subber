import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Rect, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { activeSubtitlesAt, resolveCueStyles, type Subtitle } from '../types/Subtitle';
import type { NormalizedRect, SubtitleStyle } from '../types/Style';
import { boxPadding, SAFE_MARGIN_RATIO } from '../lib/ASSGenerator';
import { fadeAlphaAt, fitTextToBox } from '../lib/textFit';
import { togglePlayback, useEditorStore } from '../lib/SubtitleStore';

interface Props {
  displayWidth: number;
  displayHeight: number;
}

/**
 * Live subtitle preview rendered with Konva on top of the video.
 * Only this layer redraws when text/style/time change — the video element
 * is untouched. Geometry mirrors ASSGenerator so preview ≈ export:
 * all style values are in video pixels, scaled by displayWidth/videoWidth.
 *
 * Two rendering modes:
 * - Free/aligned blocks (draggable to set style.position).
 * - Caption box mode: a fixed box, draggable + resizable via Transformer;
 *   text auto-fits inside (lib/textFit.ts) and cues fade in/out.
 */
export function SubtitleCanvas({ displayWidth, displayHeight }: Props) {
  const subtitles = useEditorStore((s) => s.subtitles);
  const currentTime = useEditorStore((s) => s.currentTime);
  const style = useEditorStore((s) => s.style);
  const videoWidth = useEditorStore((s) => s.videoMeta?.width ?? 1920);
  const updateStyleAt = useEditorStore((s) => s.updateStyleAt);

  const scale = displayWidth / videoWidth;
  const effective = useMemo(() => resolveCueStyles(subtitles, style), [subtitles, style]);
  const active = useMemo(
    () => activeSubtitlesAt(subtitles, currentTime),
    [subtitles, currentTime],
  );
  const styleOf = (sub: Subtitle): SubtitleStyle => effective.get(sub.id) ?? style;
  const boxCues = active.filter((s) => styleOf(s).captionBox);
  const blockCues = active.filter((s) => !styleOf(s).captionBox);

  // Re-measure once webfonts finish loading (metrics change silently).
  const [fontsReady, setFontsReady] = useState(0);
  useEffect(() => {
    let alive = true;
    document.fonts.ready.then(() => alive && setFontsReady((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [style.fontFamily]);

  const blocks = useMemo(() => {
    const safeWidth = displayWidth * (1 - SAFE_MARGIN_RATIO * 2);
    const gap = 8 * scale;
    const measured = blockCues.map((sub) => {
      const st = styleOf(sub);
      return { sub, st, ...measureBlock(sub.text, st, scale, safeWidth) };
    });

    // Stack overlapping cues away from the anchored edge, like libass does.
    // Cues with different styles stack independently per anchor group.
    const cursors = new Map<string, number>();
    return measured.map(({ sub, st, width, height, textWidth, textHeight, wrapWidth }) => {
      const anchorKey = st.position
        ? `pos:${st.position.x},${st.position.y}`
        : `align:${st.alignment}`;
      let cursor = cursors.get(anchorKey) ?? 0;
      const x = st.position
        ? st.position.x * displayWidth - width / 2
        : (displayWidth - width) / 2;
      let y: number;
      if (st.position) {
        y = st.position.y * displayHeight - height / 2 + cursor;
        cursor += height + gap;
      } else if (st.alignment === 'top') {
        y = st.marginTop * scale + cursor;
        cursor += height + gap;
      } else if (st.alignment === 'center') {
        y = (displayHeight - height) / 2 + cursor;
        cursor += height + gap;
      } else {
        cursor += height + gap;
        y = displayHeight - st.marginBottom * scale - cursor + gap;
      }
      cursors.set(anchorKey, cursor);
      return { sub, st, x, y, width, height, textWidth, textHeight, wrapWidth };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockCues, effective, scale, displayWidth, displayHeight, fontsReady]);

  const onDragEnd = (
    e: KonvaEventObject<DragEvent>,
    cueId: string,
    width: number,
    height: number,
  ) => {
    updateStyleAt(cueId, {
      position: {
        x: clamp01((e.target.x() + width / 2) / displayWidth),
        y: clamp01((e.target.y() + height / 2) / displayHeight),
      },
    });
  };

  return (
    <Stage
      width={displayWidth}
      height={displayHeight}
      onClick={(e) => {
        if (e.target === e.target.getStage()) togglePlayback();
      }}
    >
      <Layer>
        {blocks.map((b) => (
          <SubtitleBlock
            key={b.sub.id}
            block={b}
            style={b.st}
            scale={scale}
            opacity={b.st.opacity * fadeAlphaAt(currentTime, b.sub.start, b.sub.end, b.st.fadeMs)}
            onDragEnd={(e) => onDragEnd(e, b.sub.id, b.width, b.height)}
          />
        ))}
        {(boxCues.length > 0 ? boxCues.slice(0, 1) : []).map((sub) => (
          <CaptionBox
            key={styleOf(sub) === style ? 'base' : sub.id}
            active={boxCues}
            style={styleOf(sub)}
            scale={scale}
            currentTime={currentTime}
            displayWidth={displayWidth}
            displayHeight={displayHeight}
            fontsReady={fontsReady}
            onRectChange={(boxRect) => updateStyleAt(sub.id, { boxRect })}
          />
        ))}
        {boxCues.length === 0 && style.captionBox && (
          <CaptionBox
            key="base-idle"
            active={[]}
            style={style}
            scale={scale}
            currentTime={currentTime}
            displayWidth={displayWidth}
            displayHeight={displayHeight}
            fontsReady={fontsReady}
            onRectChange={(boxRect) => updateStyleAt('', { boxRect })}
          />
        )}
      </Layer>
    </Stage>
  );
}

// ─── Caption box mode ─────────────────────────────────────────────────────

function CaptionBox({
  active,
  style,
  scale,
  currentTime,
  displayWidth,
  displayHeight,
  fontsReady,
  onRectChange,
}: {
  active: Subtitle[];
  style: SubtitleStyle;
  scale: number;
  currentTime: number;
  displayWidth: number;
  displayHeight: number;
  fontsReady: number;
  onRectChange: (r: NormalizedRect) => void;
}) {
  const rectRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (rectRef.current && trRef.current) {
      trRef.current.nodes([rectRef.current]);
    }
  }, []);

  // Display-pixel geometry of the box.
  const box = {
    x: style.boxRect.x * displayWidth,
    y: style.boxRect.y * displayHeight,
    width: Math.max(20, style.boxRect.width * displayWidth),
    height: Math.max(20, style.boxRect.height * displayHeight),
  };

  const cue = active[0] ?? null;
  const fade = cue ? fadeAlphaAt(currentTime, cue.start, cue.end, style.fadeMs) : 0;

  // Fit in *video* pixels (like the ASS export), then scale down for display.
  const fitted = useMemo(() => {
    if (!cue) return null;
    const text = active.map((s) => s.text.trim()).join('\n');
    return fitTextToBox(text, style, box.width / scale, box.height / scale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cue && active.map((s) => s.text).join('\n'), style, box.width, box.height, scale, fontsReady]);

  const commitRect = () => {
    const node = rectRef.current;
    if (!node) return;
    // Bake the Transformer's scale into width/height so the model stays in px.
    const width = Math.max(20, node.width() * node.scaleX());
    const height = Math.max(20, node.height() * node.scaleY());
    node.scaleX(1);
    node.scaleY(1);
    node.width(width);
    node.height(height);
    onRectChange({
      x: clamp01(node.x() / displayWidth),
      y: clamp01(node.y() / displayHeight),
      width: Math.min(1, width / displayWidth),
      height: Math.min(1, height / displayHeight),
    });
  };

  return (
    <>
      <Rect
        ref={rectRef}
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={style.backgroundColor}
        opacity={style.backgroundOpacity * style.opacity * (cue ? fade : 0.35)}
        cornerRadius={style.borderRadius * scale}
        draggable
        onDragMove={commitRect}
        onDragEnd={commitRect}
        onTransform={commitRect}
        onTransformEnd={commitRect}
        onMouseEnter={(e) => setCursor(e, 'move')}
        onMouseLeave={(e) => setCursor(e, 'default')}
      />
      {cue && fitted && (
        <Text
          listening={false}
          // Centered via measured size, with no width constraint: Konva can
          // never truncate a line the fitter already validated.
          x={box.x + (box.width - fitted.width * scale) / 2}
          y={box.y + (box.height - fitted.height * scale) / 2}
          text={fitted.lines.join('\n')}
          wrap="none"
          align="center"
          fontFamily={style.fontFamily}
          fontSize={fitted.fontSize * scale}
          fontStyle={fontStyleOf(style)}
          textDecoration={style.underline ? 'underline' : ''}
          letterSpacing={style.letterSpacing * scale}
          lineHeight={style.lineSpacing}
          fill={style.color}
          opacity={style.opacity * fade}
          stroke={style.outlineWidth > 0 ? style.outlineColor : undefined}
          strokeWidth={style.outlineWidth > 0 ? style.outlineWidth * 2 * scale : 0}
          fillAfterStrokeEnabled
          shadowEnabled={style.shadow}
          shadowColor={style.shadowColor}
          shadowBlur={style.shadowBlur * scale}
          shadowOffsetX={style.shadowOffsetX * scale}
          shadowOffsetY={style.shadowOffsetY * scale}
        />
      )}
      <Transformer
        ref={trRef}
        rotateEnabled={false}
        flipEnabled={false}
        keepRatio={false}
        borderStroke="#6d5cff"
        anchorStroke="#6d5cff"
        anchorFill="#ffffff"
        anchorSize={8}
        boundBoxFunc={(oldBox, newBox) =>
          newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
        }
      />
    </>
  );
}

// ─── Free / aligned blocks ────────────────────────────────────────────────

interface Block {
  x: number;
  y: number;
  width: number;
  height: number;
  textWidth: number;
  textHeight: number;
  wrapWidth: number | undefined;
  sub: { id: string; text: string };
}

function SubtitleBlock({
  block,
  style,
  scale,
  opacity,
  onDragEnd,
}: {
  block: Block;
  style: SubtitleStyle;
  scale: number;
  opacity: number;
  onDragEnd: (e: KonvaEventObject<DragEvent>) => void;
}) {
  const pad = style.background ? boxPadding(style) * scale : 0;
  // Box mode disables outline/shadow — mirroring ASS BorderStyle=3 limits.
  const showOutline = !style.background && style.outlineWidth > 0;
  const showShadow = !style.background && style.shadow;

  return (
    <Group
      x={block.x}
      y={block.y}
      opacity={opacity}
      draggable
      onDragEnd={onDragEnd}
      onMouseEnter={(e) => setCursor(e, 'move')}
      onMouseLeave={(e) => setCursor(e, 'default')}
    >
      {style.background && (
        <Rect
          width={block.width}
          height={block.height}
          fill={style.backgroundColor}
          opacity={style.backgroundOpacity}
          cornerRadius={style.borderRadius * scale}
        />
      )}
      <Text
        x={pad}
        y={pad}
        width={block.wrapWidth}
        text={block.sub.text}
        align="center"
        fontFamily={style.fontFamily}
        fontSize={style.fontSize * scale}
        fontStyle={fontStyleOf(style)}
        textDecoration={style.underline ? 'underline' : ''}
        letterSpacing={style.letterSpacing * scale}
        lineHeight={style.lineSpacing}
        fill={style.color}
        stroke={showOutline ? style.outlineColor : undefined}
        // Konva strokes are centered on the glyph edge; doubling matches
        // ASS's outward outline width.
        strokeWidth={showOutline ? style.outlineWidth * 2 * scale : 0}
        fillAfterStrokeEnabled
        shadowEnabled={showShadow}
        shadowColor={style.shadowColor}
        shadowBlur={style.shadowBlur * scale}
        shadowOffsetX={style.shadowOffsetX * scale}
        shadowOffsetY={style.shadowOffsetY * scale}
      />
    </Group>
  );
}

/** Measures a subtitle block in display pixels, wrapping at the safe width. */
function measureBlock(text: string, style: SubtitleStyle, scale: number, safeWidth: number) {
  const node = new Konva.Text({
    text,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize * scale,
    fontStyle: fontStyleOf(style),
    letterSpacing: style.letterSpacing * scale,
    lineHeight: style.lineSpacing,
    align: 'center',
  });
  let wrapWidth: number | undefined;
  if (node.width() > safeWidth) {
    wrapWidth = safeWidth;
    node.width(safeWidth);
  }
  const textWidth = node.width();
  const textHeight = node.height();
  node.destroy();
  const pad = style.background ? boxPadding(style) * scale : 0;
  return {
    textWidth,
    textHeight,
    wrapWidth,
    width: textWidth + pad * 2,
    height: textHeight + pad * 2,
  };
}

function fontStyleOf(style: SubtitleStyle): string {
  if (style.bold && style.italic) return 'italic bold';
  if (style.bold) return 'bold';
  if (style.italic) return 'italic';
  return 'normal';
}

function setCursor(e: KonvaEventObject<MouseEvent>, cursor: string) {
  const stage = e.target.getStage();
  if (stage) stage.container().style.cursor = cursor;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
