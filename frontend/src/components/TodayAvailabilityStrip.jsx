import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock, ChevronRight } from "lucide-react";
import api from "@/lib/api";
import {
  todayYmdSaoPaulo,
  isOpenDay,
} from "@/lib/siteConfig";
import { useSiteSettings } from "@/lib/SiteSettings";
import { useMotionSystem } from "@/lib/motion";
import { Skeleton } from "@/components/ui/skeleton";

const COURT_ID = "court-1";

function isFree(slot) {
  return slot?.status === "available" || slot?.status === "free" || slot?.legacy_status === "free";
}
function isReserved(slot) {
  return (
    slot?.status === "reserved" ||
    slot?.status === "occupied" ||
    slot?.legacy_status === "occupied"
  );
}

function chipClass(slot) {
  if (isFree(slot)) {
    return "border-[var(--success)]/55 bg-[var(--success)]/10 text-[var(--success)] shadow-[0_0_14px_rgba(0,255,102,0.18)] hover:bg-[var(--success)]/20 hover:border-[var(--success)] cursor-pointer";
  }
  if (isReserved(slot)) {
    return "border-[var(--danger)]/45 bg-[var(--danger)]/10 text-[var(--danger)]/90 opacity-80 cursor-default";
  }
  return "border-white/15 bg-white/5 text-white/40 cursor-default";
}

function bookingHref(ymd, time) {
  if (!ymd || !time) return "/booking";
  const q = new URLSearchParams({ date: ymd, time });
  return `/booking?${q.toString()}`;
}

/**
 * Compact mobile-first strip of today's slots (America/Sao_Paulo).
 * Green free / red reserved / gray unavailable. Free → /booking?date&time.
 */
export default function TodayAvailabilityStrip() {
  const { settings } = useSiteSettings();
  const { reduce } = useMotionSystem();
  const today = useMemo(() => todayYmdSaoPaulo(), []);
  const closedBySettings = !isOpenDay(today, settings);

  const [loading, setLoading] = useState(!closedBySettings);
  const [error, setError] = useState(false);
  const [payload, setPayload] = useState(null);

  useEffect(() => {
    if (closedBySettings) {
      setLoading(false);
      setPayload(null);
      setError(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    api
      .get("/courts/availability", { params: { court_id: COURT_ID, date: today } })
      .then(({ data }) => {
        if (cancelled) return;
        setPayload(data);
        setError(false);
      })
      .catch(() => {
        if (cancelled) return;
        setPayload(null);
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [today, closedBySettings]);

  // Hide when closed today (settings or API day_open)
  if (closedBySettings) return null;
  if (!loading && !error && payload && payload.day_open === false) return null;

  const slots = Array.isArray(payload?.slots) ? payload.slots : [];
  const freeCount = slots.filter(isFree).length;

  if (error) {
    return (
      <section
        className="relative py-4 sm:py-5 border-b border-white/5"
        data-testid="landing-today-strip-fallback"
        aria-label="Horários de hoje"
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10">
          <Link
            to="/booking"
            className="inline-flex items-center gap-1.5 text-sm text-white/55 hover:text-[var(--brand)] transition-colors"
            data-testid="landing-today-ver-horarios"
          >
            Ver horários <ChevronRight className="w-4 h-4" aria-hidden />
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      className="relative py-5 sm:py-6 border-b border-white/5 bg-black/25"
      data-testid="landing-today-strip"
      aria-label="Disponibilidade de hoje"
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div>
            <div className="text-[10px] tracking-[0.4em] uppercase text-[var(--brand)] flex items-center gap-1.5">
              <Clock className="w-3 h-3" aria-hidden /> Hoje · {today.split("-").reverse().join("/")}
            </div>
            <h2 className="font-heading text-xl sm:text-2xl uppercase italic tracking-tight mt-0.5">
              Horários{" "}
              <span className="text-[var(--brand)] text-glow-strong">disponíveis</span>
            </h2>
          </div>
          {!loading && (
            <Link
              to="/booking"
              className="text-[11px] uppercase tracking-[0.2em] text-white/50 hover:text-[var(--brand)] inline-flex items-center gap-1"
              data-testid="landing-today-all-link"
            >
              Ver todos <ChevronRight className="w-3.5 h-3.5" aria-hidden />
            </Link>
          )}
        </div>

        {loading && (
          <div
            className="flex gap-2 overflow-hidden"
            data-testid="landing-today-skeleton"
            aria-busy="true"
            aria-label="Carregando horários"
          >
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton
                key={i}
                className={`h-10 w-[4.5rem] shrink-0 rounded-full bg-white/10 ${reduce ? "" : ""}`}
              />
            ))}
          </div>
        )}

        {!loading && slots.length > 0 && (
          <>
            <ul
              className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x snap-mandatory scrollbar-thin"
              data-testid="landing-today-chips"
              aria-label={`${freeCount} horário${freeCount === 1 ? "" : "s"} livre${freeCount === 1 ? "" : "s"} hoje`}
            >
              {slots.map((slot) => {
                const free = isFree(slot);
                const label = free
                  ? "livre"
                  : isReserved(slot)
                    ? "reservado"
                    : "indisponível";
                const time = slot.time;
                const inner = (
                  <span className="font-display text-sm tabular-nums tracking-wide">{time}</span>
                );
                const className = `snap-start shrink-0 inline-flex items-center justify-center min-h-[40px] min-w-[4.25rem] px-3 rounded-full border text-center transition-colors ${
                  reduce ? "" : "duration-200"
                } ${chipClass(slot)}`;

                return (
                  <li key={time} className="list-none">
                    {free ? (
                      <Link
                        to={bookingHref(today, time)}
                        className={className}
                        data-testid={`landing-today-slot-${time}`}
                        aria-label={`${time} ${label} — reservar`}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <span
                        className={className}
                        data-testid={`landing-today-slot-${time}`}
                        aria-label={`${time} ${label}`}
                        aria-disabled="true"
                      >
                        {inner}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.18em] text-white/45">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--success)] shadow-[0_0_6px_var(--success)]" /> Livre
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-[var(--danger)]" /> Reservado
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-white/30" /> Indisponível
              </span>
            </div>
          </>
        )}

        {!loading && slots.length === 0 && (
          <p className="text-sm text-white/55" data-testid="landing-today-empty">
            Sem horários listados para hoje.{" "}
            <Link to="/booking" className="text-[var(--brand)] hover:underline">
              Ver reserva
            </Link>
          </p>
        )}
      </div>
    </section>
  );
}
