import React, { useCallback, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

export default function FutsalArenaBackdrop({
  videoSrc,
  posterSrc,
  fallbackSrc,
  reduceMotion = false,
}) {
  const videoRef = useRef(null);
  const [soundOn, setSoundOn] = useState(false);

  const toggleSound = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    if (soundOn) {
      video.muted = true;
      setSoundOn(false);
      return;
    }

    try {
      video.volume = 0.42;
      video.muted = false;
      await video.play();
      setSoundOn(true);
    } catch {
      video.muted = true;
      setSoundOn(false);
    }
  }, [soundOn]);

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="false">
      {reduceMotion ? (
        <img
          src={posterSrc || fallbackSrc}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
          decoding="async"
        />
      ) : (
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover hero-baleys-video"
          src={videoSrc}
          poster={posterSrc || fallbackSrc}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          disablePictureInPicture
          disableRemotePlayback
          aria-hidden="true"
        />
      )}

      {!reduceMotion && (
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={soundOn}
          data-testid="arena-sound-toggle"
          className="pointer-events-auto absolute right-4 sm:right-7 bottom-5 sm:bottom-7 z-[40] min-h-[44px] inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/65 px-4 py-2.5 text-[11px] sm:text-xs uppercase tracking-[0.16em] text-white/85 backdrop-blur-md shadow-[0_12px_40px_rgba(0,0,0,0.35)] transition hover:border-[var(--brand)]/70 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
        >
          {soundOn ? (
            <Volume2 className="w-4 h-4 text-[var(--brand)]" />
          ) : (
            <VolumeX className="w-4 h-4 text-white/70" />
          )}
          <span>{soundOn ? "Som da quadra ligado" : "Ativar som da quadra"}</span>
        </button>
      )}
    </div>
  );
}
