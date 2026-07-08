import { useEffect, useRef, useState } from 'react';
import {
  registerVideoElement,
  seekVideo,
  togglePlayback,
  useEditorStore,
} from '../lib/SubtitleStore';
import { formatTime } from '../lib/time';
import { SubtitleCanvas } from './SubtitleCanvas';

interface VideoRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Video preview surface. The <video> element is mounted once per source and
 * never re-renders on state changes — subtitles are drawn on a Konva canvas
 * absolutely positioned over the video's letterboxed content rect.
 */
export function VideoPlayer() {
  const videoUrl = useEditorStore((s) => s.videoUrl);
  const videoMeta = useEditorStore((s) => s.videoMeta);
  const setVideoMeta = useEditorStore((s) => s.setVideoMeta);
  const setCurrentTime = useEditorStore((s) => s.setCurrentTime);
  const setPlaying = useEditorStore((s) => s.setPlaying);

  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [rect, setRect] = useState<VideoRect | null>(null);

  // Track the letterboxed content rect of the video inside its container.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !videoMeta) return;
    const update = () => {
      const cw = container.clientWidth;
      const ch = container.clientHeight;
      if (!cw || !ch) return;
      const scale = Math.min(cw / videoMeta.width, ch / videoMeta.height);
      const width = videoMeta.width * scale;
      const height = videoMeta.height * scale;
      setRect({ left: (cw - width) / 2, top: (ch - height) / 2, width, height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, [videoMeta]);

  // Smooth 60fps clock while playing (timeupdate alone is too coarse).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    registerVideoElement(video);

    let raf = 0;
    const tick = () => {
      setCurrentTime(video.currentTime);
      raf = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      cancelAnimationFrame(raf);
      setCurrentTime(video.currentTime);
    };
    const onLoaded = () => {
      const s = useEditorStore.getState();
      const pathName = s.videoPath?.split(/[\\/]/).pop();
      setVideoMeta({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        name: s.videoFile?.name ?? pathName ?? 'video',
        path: s.videoPath ?? undefined,
      });
    };
    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('seeked', () => setCurrentTime(video.currentTime));
    video.addEventListener('loadedmetadata', onLoaded);
    return () => {
      cancelAnimationFrame(raf);
      registerVideoElement(null);
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('loadedmetadata', onLoaded);
    };
  }, [videoUrl, setCurrentTime, setPlaying, setVideoMeta]);

  if (!videoUrl) return null;

  return (
    <div className="player">
      <div className="player__stage" ref={containerRef}>
        <video ref={videoRef} src={videoUrl} className="player__video" playsInline />
        {rect && videoMeta && (
          <div
            className="player__overlay"
            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
          >
            <SubtitleCanvas displayWidth={rect.width} displayHeight={rect.height} />
          </div>
        )}
      </div>
      <PlayerControls />
    </div>
  );
}

function PlayerControls() {
  const isPlaying = useEditorStore((s) => s.isPlaying);
  const duration = useEditorStore((s) => s.videoMeta?.duration ?? 0);
  return (
    <div className="player__controls">
      <button
        className="btn btn--icon"
        onClick={togglePlayback}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      >
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button className="btn btn--icon" onClick={() => seekVideo(0)} title="Back to start">
        ⏮
      </button>
      <TimeDisplay />
      <span className="player__duration">/ {formatTime(duration)}</span>
    </div>
  );
}

/** Isolated so the 60fps clock only re-renders this tiny component. */
function TimeDisplay() {
  const currentTime = useEditorStore((s) => s.currentTime);
  return <span className="player__time">{formatTime(currentTime)}</span>;
}
