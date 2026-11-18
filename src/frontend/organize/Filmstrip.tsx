import React, { useRef, useState } from 'react';
import styled from 'styled-components';
import type {
  OrganizeSplitThumbnailFrame,
  SplitSegment,
} from '../../common/organizer/split';
import { formatSplitTimecode } from '../../common/organizer/split';

export interface FilmstripCutCandidates {
  /** 1-based segment index whose start is this cut. */
  index: number;
  label: string;
  /** Alternative keyframes that are valid for this cut. */
  seconds: number[];
  /** Where copy mode will actually cut today. */
  actualSeconds?: number;
  active: boolean;
}

export interface FilmstripProps {
  duration: number;
  windowStart: number;
  windowSeconds: number;
  segments: SplitSegment[];
  frames: OrganizeSplitThumbnailFrame[];
  playhead: number;
  onPlayheadChange: (seconds: number) => void;
  /** Moves the cut that starts segment `index`. */
  onMarkerChange: (index: number, seconds: number) => void;
  /** Called when a cut drag finishes, so the caller can snap and refresh. */
  onMarkerCommit?: (index: number) => void;
  /** Copy-mode keyframe options per cut, rendered as ticks on the strip. */
  cutCandidates?: FilmstripCutCandidates[];
  onCandidateSelect?: (index: number, seconds: number) => void;
  disabled?: boolean;
  /** Filmstrip samples are still being extracted. */
  loading?: boolean;
}

const Strip = styled.div`
  position: relative;
  display: flex;
  height: 104px;
  border: 1px solid var(--hb-border);
  border-radius: var(--hb-radius-md);
  overflow: hidden;
  background: var(--hb-surfaceAlt, #1e1e24);
  cursor: crosshair;
  user-select: none;
  touch-action: none;
`;

const Tile = styled.div<{ $src?: string }>`
  flex: 1 1 0;
  min-width: 0;
  position: relative;
  background-color: #101014;
  background-image: ${(props) =>
    props.$src ? `url(${props.$src})` : undefined};
  background-size: cover;
  background-position: center;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  & > span {
    position: absolute;
    left: 3px;
    bottom: 2px;
    padding: 0 3px;
    border-radius: 2px;
    background: rgba(0, 0, 0, 0.62);
    color: #fff;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
`;

const Band = styled.div<{ $start: number; $width: number; $index: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${(props) => props.$start}%;
  width: ${(props) => props.$width}%;
  pointer-events: none;
  background: ${(props) =>
    props.$index % 2 === 0
      ? 'rgba(80, 160, 255, 0.08)'
      : 'rgba(120, 220, 160, 0.08)'};
  border-top: 2px solid
    ${(props) =>
      props.$index % 2 === 0
        ? 'rgba(80, 160, 255, 0.5)'
        : 'rgba(120, 220, 160, 0.5)'};
  & > span {
    position: absolute;
    left: 4px;
    top: 4px;
    color: var(--hb-text);
    font-size: 10px;
    font-weight: 600;
    text-shadow: 0 1px 2px #000;
  }
`;

const Marker = styled.button<{ $left: number; $active: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${(props) => props.$left}%;
  width: 2px;
  padding: 0;
  border: 0;
  transform: translateX(-1px);
  background: ${(props) =>
    props.$active ? 'var(--hb-warning)' : 'var(--hb-accent, #4f8cff)'};
  cursor: ew-resize;
  z-index: 2;

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: -5px;
    width: 12px;
    height: 14px;
    border-radius: 0 0 4px 4px;
    background: inherit;
  }
`;

const Playhead = styled.div<{ $left: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${(props) => props.$left}%;
  width: 1px;
  background: #fff;
  pointer-events: none;
  z-index: 3;
  box-shadow: 0 0 4px rgba(255, 255, 255, 0.8);
`;

const LandingLine = styled.div<{ $left: number; $active: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  left: ${(props) => props.$left}%;
  width: 0;
  border-left: 2px dashed var(--hb-warning);
  opacity: ${(props) => (props.$active ? 0.95 : 0.4)};
  pointer-events: none;
  z-index: 2;
`;

const CandidateTick = styled.button<{ $left: number; $active: boolean }>`
  position: absolute;
  bottom: 0;
  left: ${(props) => props.$left}%;
  width: 5px;
  height: 16px;
  padding: 0;
  border: 0;
  border-radius: 2px 2px 0 0;
  transform: translateX(-50%);
  background: ${(props) =>
    props.$active ? 'var(--hb-warning)' : 'rgba(255, 255, 255, 0.62)'};
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.8);
  cursor: pointer;
  z-index: 2;

  &:hover {
    height: 24px;
    background: var(--hb-warning);
  }

  &:focus-visible {
    outline: 2px solid var(--hb-focus);
    outline-offset: 1px;
  }
`;

const Ruler = styled.div`
  display: flex;
  justify-content: space-between;
  color: var(--hb-textMuted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  padding: 2px 1px 0;
`;

function percentFor(seconds: number, start: number, span: number): number {
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(100, ((seconds - start) / span) * 100));
}

/** The filmstrip: sampled frames plus draggable cut markers. */
export const Filmstrip: React.FC<FilmstripProps> = ({
  duration,
  windowStart,
  windowSeconds,
  segments,
  frames,
  playhead,
  onPlayheadChange,
  onMarkerChange,
  onMarkerCommit,
  cutCandidates,
  onCandidateSelect,
  disabled,
  loading,
}) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | undefined>(undefined);
  const [scrubbing, setScrubbing] = useState(false);
  const finishMarkerDrag = () => {
    if (dragging !== undefined) onMarkerCommit?.(dragging);
    setDragging(undefined);
    setScrubbing(false);
  };
  const timeFor = (clientX: number, applySnap = true): number => {
    const element = stripRef.current;
    if (!element) return windowStart;
    const rect = element.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const raw = windowStart + ratio * windowSeconds;
    return applySnap ? Math.round(raw * 10) / 10 : raw;
  };

  return (
    <div>
      <Strip
        ref={stripRef}
        aria-label="Filmstrip scrubber"
        onPointerDown={(event) => {
          if (disabled) return;
          if (event.button !== 0) return;
          setScrubbing(true);
          onPlayheadChange(timeFor(event.clientX));
        }}
        onPointerMove={(event) => {
          if (disabled) return;
          if (dragging !== undefined) {
            const next = timeFor(event.clientX);
            const previous =
              dragging > 1 ? (segments[dragging - 1]?.startSeconds ?? 0) : 0;
            const following =
              dragging < segments.length - 1
                ? (segments[dragging + 1]?.startSeconds ?? duration)
                : duration;
            const cut = Math.max(previous + 1, Math.min(following - 1, next));
            onMarkerChange(dragging, cut);
            // Keep the live preview on the cut the user is dragging.
            onPlayheadChange(cut);
            return;
          }
          if (!scrubbing) return;
          onPlayheadChange(timeFor(event.clientX));
        }}
        onPointerUp={finishMarkerDrag}
        onPointerLeave={finishMarkerDrag}
      >
        {frames.length > 0 ? (
          frames.map((frame) => (
            <Tile key={frame.seconds} $src={frame.dataUrl}>
              <span>{formatSplitTimecode(frame.seconds)}</span>
            </Tile>
          ))
        ) : (
          <Tile>
            <span>{loading ? 'Loading frames…' : 'No frames'}</span>
          </Tile>
        )}
        {segments.map((segment, index) => {
          const start = percentFor(
            segment.startSeconds,
            windowStart,
            windowSeconds,
          );
          const end = percentFor(
            segment.endSeconds,
            windowStart,
            windowSeconds,
          );
          return (
            <Band
              key={`band-${index}`}
              $start={start}
              $width={Math.max(0.2, end - start)}
              $index={index}
            >
              <span>{segment.episode?.tag ?? `Segment ${index + 1}`}</span>
            </Band>
          );
        })}
        {cutCandidates?.map((group) =>
          group.actualSeconds !== undefined ? (
            <LandingLine
              key={`landing-${group.index}`}
              $left={percentFor(
                group.actualSeconds,
                windowStart,
                windowSeconds,
              )}
              $active={group.active}
              title={`Copy cut lands at ${formatSplitTimecode(group.actualSeconds, true)}`}
            />
          ) : null,
        )}
        {cutCandidates?.flatMap((group) =>
          group.seconds
            .filter(
              (seconds) =>
                seconds >= windowStart &&
                seconds <= windowStart + windowSeconds,
            )
            .map((seconds) => (
              <CandidateTick
                key={`candidate-${group.index}-${seconds}`}
                type="button"
                $left={percentFor(seconds, windowStart, windowSeconds)}
                $active={group.active}
                title={`Use ${formatSplitTimecode(seconds, true)} for the cut before ${group.label}`}
                aria-label={`Use ${formatSplitTimecode(seconds, true)} for the cut before ${group.label}`}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onCandidateSelect?.(group.index, seconds);
                }}
              />
            )),
        )}
        {segments.slice(1).map((segment, index) => {
          const markerIndex = index + 1;
          return (
            <Marker
              key={`marker-${markerIndex}`}
              type="button"
              aria-label={`Cut before ${segment.episode?.tag ?? `segment ${markerIndex + 1}`}`}
              $left={percentFor(
                segment.startSeconds,
                windowStart,
                windowSeconds,
              )}
              $active={dragging === markerIndex}
              disabled={disabled}
              onPointerDown={(event) => {
                if (disabled) return;
                event.stopPropagation();
                (event.target as HTMLElement).setPointerCapture?.(
                  event.pointerId,
                );
                setDragging(markerIndex);
                onPlayheadChange(segment.startSeconds);
              }}
              onClick={(event) => event.stopPropagation()}
            />
          );
        })}
        <Playhead $left={percentFor(playhead, windowStart, windowSeconds)} />
      </Strip>
      <Ruler>
        <span>{formatSplitTimecode(windowStart, true)}</span>
        <span>{formatSplitTimecode(windowStart + windowSeconds, true)}</span>
      </Ruler>
    </div>
  );
};
