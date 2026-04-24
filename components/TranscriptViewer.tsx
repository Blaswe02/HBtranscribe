import React, { useEffect, useMemo, useState } from "react";

export type TranscriptSegment = {
  start_ms: number;
  end_ms: number;
  speaker?: string;
  text: string;
};

function formatTime(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function TranscriptViewer(props: {
  segments: TranscriptSegment[];
  audioRef: React.RefObject<HTMLAudioElement>;
  showSpeakers?: boolean;
  search?: string;
}) {
  const { segments, audioRef, showSpeakers = true, search = "" } = props;
  const [activeIndex, setActiveIndex] = useState<number>(-1);

  const normalizedSearch = search.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!normalizedSearch) return segments.map((s, i) => ({ s, i }));
    return segments
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => s.text.toLowerCase().includes(normalizedSearch));
  }, [segments, normalizedSearch]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => {
      const tMs = audio.currentTime * 1000;

      // kleine linear scan; prima voor MVP
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (tMs >= seg.start_ms && tMs <= seg.end_ms) {
          setActiveIndex(i);
          return;
        }
      }
      setActiveIndex(-1);
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("seeked", onTimeUpdate);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("seeked", onTimeUpdate);
    };
  }, [audioRef, segments]);

  const jumpTo = (index: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const seg = segments[index];
    audio.currentTime = seg.start_ms / 1000;
    audio.play().catch(() => {});
  };

  return (
    <div className="w-full">
      <div className="text-xs text-slate-400 mb-2">
        {filtered.length} segment(en)
        {normalizedSearch ? " (gefilterd)" : ""}
      </div>

      <div className="space-y-2">
        {filtered.map(({ s, i }) => {
          const isActive = i === activeIndex;
          return (
            <button
              key={`${i}-${s.start_ms}`}
              onClick={() => jumpTo(i)}
              className={[
                "w-full text-left rounded-xl border p-3 transition",
                isActive
                  ? "border-blue-500 bg-blue-50"
                  : "border-slate-200 bg-white hover:bg-slate-50",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-slate-500">
                    {formatTime(s.start_ms)}
                  </span>
                  {showSpeakers && s.speaker ? (
                    <span className="text-xs font-bold text-slate-600">
                      {s.speaker}
                    </span>
                  ) : null}
                </div>
                <span className="text-[10px] text-slate-400">
                  klik om te springen
                </span>
              </div>
              <div className="mt-1 text-sm text-slate-800 leading-relaxed">
                {s.text}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}