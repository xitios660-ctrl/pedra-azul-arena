import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import PageShell from "@/components/PageShell";
import { TOURN } from "@/constants/testIds";
import api from "@/lib/api";
import { useSiteSettings } from "@/lib/SiteSettings";
import { whatsappUrl, tournamentInterestPrefill } from "@/lib/siteConfig";
import { useMotionSystem } from "@/lib/motion";
import {
  Trophy,
  Goal,
  Activity,
  ChevronRight,
  Crown,
  CalendarDays,
  Banknote,
  MessageCircle,
  Users,
} from "lucide-react";

const STATUS_MAP = {
  live: { label: "Ao vivo", color: "var(--success)", border: "var(--success)" },
  finished: { label: "Encerrado", color: "var(--text-2)", border: "rgba(255,255,255,0.25)" },
  scheduled: { label: "Agendado", color: "var(--warning)", border: "var(--warning)" },
  open: { label: "Inscrições", color: "var(--brand)", border: "var(--brand)" },
  registration: { label: "Inscrições", color: "var(--brand)", border: "var(--brand)" },
};

function StatusBadge({ status }) {
  const v = STATUS_MAP[status] || STATUS_MAP.scheduled;
  return (
    <span
      className="inline-flex items-center text-[10px] uppercase tracking-[0.28em] px-2.5 py-1 border bg-black/50 backdrop-blur-sm"
      style={{ color: v.color, borderColor: v.border }}
    >
      {status === "live" && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] mr-1.5 animate-pulse" aria-hidden />
      )}
      {v.label}
    </span>
  );
}

function formatLabel(format) {
  if (format === "knockout") return "Mata-mata";
  if (format === "league") return "Liga";
  return format || "Torneio";
}

/** Date range from real match schedule only — never invent dates. */
function matchDateRange(tournament) {
  const dates = (tournament?.matches || [])
    .map((m) => m?.scheduled_at)
    .filter(Boolean)
    .map((d) => new Date(d))
    .filter((d) => !Number.isNaN(d.getTime()))
    .sort((a, b) => a - b);
  if (!dates.length) return null;
  return { from: dates[0], to: dates[dates.length - 1] };
}

function formatDateShort(d) {
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function formatDateRangeLabel(range) {
  if (!range) return null;
  const a = formatDateShort(range.from);
  const b = formatDateShort(range.to);
  if (a === b) return a;
  return `${a} — ${b}`;
}

/** Show price only when API/seed provides a numeric fee field. */
function tournamentPriceLabel(t) {
  const raw = t?.entry_fee ?? t?.registration_fee ?? t?.price ?? null;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    const s = String(raw).trim();
    return s || null;
  }
  if (n === 0) return "Grátis";
  return `R$ ${n % 1 === 0 ? n : n.toFixed(2)}`;
}

function InterestButton({ tournament, className = "", size = "md" }) {
  const { waReady, settings } = useSiteSettings();
  if (!waReady) return null;
  const href = whatsappUrl(
    tournamentInterestPrefill(tournament?.name),
    settings.whatsapp_e164
  );
  const pad = size === "sm" ? "!py-2 !px-3 !text-xs" : "!py-2.5 !px-4 !text-sm";
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={TOURN.interestCta(tournament?.id || "list")}
      onClick={(e) => e.stopPropagation()}
      className={`btn-ghost ${pad} !border-[#25D366]/40 hover:!border-[#25D366] inline-flex items-center gap-2 ${className}`}
      aria-label={`Interessado no torneio ${tournament?.name || ""} — WhatsApp`}
    >
      <MessageCircle className="w-4 h-4 text-[#25D366]" aria-hidden />
      Interessado
    </a>
  );
}

function TournamentMeta({ tournament, compact }) {
  const range = matchDateRange(tournament);
  const rangeLabel = formatDateRangeLabel(range);
  const price = tournamentPriceLabel(tournament);
  const teams = tournament?.teams?.length ?? 0;
  const matches = tournament?.matches?.length ?? 0;
  return (
    <div
      className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 ${
        compact ? "text-xs text-white/65" : "text-sm text-white/70"
      }`}
    >
      {rangeLabel && (
        <span className="inline-flex items-center gap-1.5">
          <CalendarDays className="w-3.5 h-3.5 text-[var(--brand)]" aria-hidden />
          {rangeLabel}
        </span>
      )}
      {price && (
        <span className="inline-flex items-center gap-1.5">
          <Banknote className="w-3.5 h-3.5 text-[var(--brand)]" aria-hidden />
          {price}
        </span>
      )}
      <span className="inline-flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5 text-[var(--brand)]" aria-hidden />
        {teams} {teams === 1 ? "time" : "times"}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Activity className="w-3.5 h-3.5 text-[var(--brand)]" aria-hidden />
        {matches} {matches === 1 ? "partida" : "partidas"}
      </span>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div
      data-testid={TOURN.skeleton}
      className="grid sm:grid-cols-2 gap-4 sm:gap-6"
      aria-busy="true"
      aria-label="Carregando torneios"
    >
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="skeleton-card h-[240px] sm:h-[260px]" />
      ))}
    </div>
  );
}

function EmptyTournaments({ waReady, waHref }) {
  return (
    <div data-testid={TOURN.empty} className="glass state-panel py-14 px-6 text-center">
      <Trophy className="w-10 h-10 text-white/25 mx-auto mb-4" aria-hidden />
      <div className="font-heading text-2xl sm:text-3xl uppercase italic">Nenhum torneio no momento</div>
      <p className="text-sm text-white/55 mt-2 max-w-md mx-auto">
        Quando a Copa Alto Tietê ou outras competições forem publicadas, elas aparecem aqui.
        {waReady ? " Enquanto isso, reserve a quadra ou fale no WhatsApp." : " Enquanto isso, reserve a quadra."}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to="/booking" className="btn-neon !py-2.5 !px-5 !text-sm">
          Reservar horário
        </Link>
        {waReady && waHref && (
          <a href={waHref} target="_blank" rel="noopener noreferrer" className="btn-ghost !py-2.5 !px-4 !text-sm">
            <MessageCircle className="w-4 h-4 text-[#25D366]" /> WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}

export function TournamentsList() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const { fadeUp } = useMotionSystem();
  const { waReady, waHref } = useSiteSettings();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    api
      .get("/tournaments")
      .then(({ data }) => {
        if (!cancelled) setList(Array.isArray(data) ? data : []);
      })
      .catch(() => {
        if (!cancelled) {
          setList([]);
          setError("Não foi possível carregar os torneios.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageShell>
      <div data-testid={TOURN.list} className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-8 sm:py-12">
        <div className="diagonal-stripe pb-5 sm:pb-6 mb-8 sm:mb-10">
          <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2">
            // Competições
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl md:text-7xl uppercase italic leading-[0.9]">
            Campeonatos <span className="text-[var(--brand)]">Ativos</span>
          </h1>
          <p className="text-white/60 mt-3 text-sm sm:text-base max-w-2xl">
            Brackets, classificação e artilharia — dados reais da arena. Interessado? Fale no WhatsApp.
          </p>
        </div>

        {loading && <ListSkeleton />}

        {!loading && error && (
          <div className="glass state-panel py-10 px-6 text-center border-[var(--danger)]/30">
            <div className="font-heading text-2xl uppercase text-white/80">{error}</div>
            <p className="text-sm text-white/50 mt-2">Tente novamente em instantes.</p>
          </div>
        )}

        {!loading && !error && list.length === 0 && (
          <EmptyTournaments waReady={waReady} waHref={waHref} />
        )}

        {!loading && !error && list.length > 0 && (
          <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
            {list.map((t, i) => (
              <motion.div key={t.id} {...fadeUp(Math.min(i * 0.08, 0.32))} className="relative group">
                <Link
                  to={`/tournaments/${t.id}`}
                  data-testid={TOURN.card(t.id)}
                  className="relative block min-h-[240px] sm:h-[280px] overflow-hidden border border-white/10 hover:border-[var(--brand)] transition-colors"
                >
                  {t.banner ? (
                    <img
                      src={t.banner}
                      alt=""
                      className="absolute inset-0 w-full h-full object-cover scale-105 group-hover:scale-110 transition-transform duration-700"
                      loading="lazy"
                    />
                  ) : (
                    <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand)]/30 via-black to-[#030305]" />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/75 to-black/25" />
                  <div className="absolute top-3 left-3 right-3 flex items-start justify-between gap-2">
                    <span className="text-[10px] uppercase tracking-[0.28em] text-[var(--brand)] bg-black/45 px-2 py-1 border border-[var(--brand)]/30">
                      {formatLabel(t.format)}
                      {t.season ? ` · ${t.season}` : ""}
                    </span>
                    <StatusBadge status={t.status} />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 p-4 sm:p-6">
                    <div className="font-heading text-3xl sm:text-4xl uppercase italic leading-[0.92] pr-2">
                      {t.name}
                    </div>
                    <div className="mt-3">
                      <TournamentMeta tournament={t} compact />
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.22em] text-white/70">
                        Ver detalhes <ChevronRight className="w-3.5 h-3.5 text-[var(--brand)]" />
                      </span>
                    </div>
                  </div>
                </Link>
                <div className="absolute bottom-4 right-4 sm:bottom-6 sm:right-6 z-10">
                  <InterestButton tournament={t} size="sm" />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </PageShell>
  );
}

export function TournamentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [t, setT] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("bracket");
  const { fadeIn } = useMotionSystem();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .get(`/tournaments/${id}`)
      .then(({ data }) => {
        if (cancelled) return;
        setT(data);
        setTab(data.format === "league" ? "leaderboard" : "bracket");
      })
      .catch(() => {
        if (!cancelled) navigate("/tournaments");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, navigate]);

  const finishedMatches = useMemo(
    () => (t?.matches || []).filter((m) => m.status === "finished"),
    [t]
  );

  if (loading || !t) {
    return (
      <PageShell>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-12" aria-busy="true">
          <div className="skeleton-card h-[28vh] sm:h-[36vh] mb-8" />
          <div className="skeleton-card h-10 w-full max-w-md mb-6" />
          <div className="grid gap-4">
            <div className="skeleton-card h-24" />
            <div className="skeleton-card h-24" />
          </div>
          <p className="sr-only">Carregando torneio…</p>
        </div>
      </PageShell>
    );
  }

  const tabs = [
    t.format === "knockout" && { id: "bracket", label: "Chaves" },
    { id: "leaderboard", label: "Classificação" },
    { id: "scorers", label: "Artilharia" },
    { id: "history", label: "Histórico" },
  ].filter(Boolean);

  return (
    <PageShell>
      <div className="relative h-[36vh] sm:h-[40vh] min-h-[220px] overflow-hidden">
        {t.banner ? (
          <img src={t.banner} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-[var(--brand)]/25 via-black to-[#030305]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#030305] via-black/65 to-black/35" />
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute bottom-0 left-0 right-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 pb-6 sm:pb-8">
            <Link
              to="/tournaments"
              className="inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.28em] text-white/50 hover:text-[var(--brand)] mb-3"
            >
              ← Campeonatos
            </Link>
            <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)]">
              // {formatLabel(t.format)}
              {t.season ? ` · ${t.season}` : ""}
            </div>
            <h1 className="font-heading text-4xl sm:text-5xl md:text-7xl uppercase italic leading-[0.9] mt-1">
              {t.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <StatusBadge status={t.status} />
              <TournamentMeta tournament={t} />
            </div>
            <div className="mt-4">
              <InterestButton tournament={t} />
            </div>
          </div>
        </div>
      </div>

      <motion.div {...fadeIn(0.05)} data-testid={TOURN.detail} className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-8 sm:py-10">
        <div className="flex gap-1 sm:gap-2 mb-6 sm:mb-8 border-b border-white/10 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0">
          {tabs.map((it) => (
            <button
              key={it.id}
              type="button"
              onClick={() => setTab(it.id)}
              className={`shrink-0 px-3 sm:px-4 py-3 font-heading uppercase tracking-[0.18em] text-xs sm:text-sm border-b-2 transition-colors ${
                tab === it.id
                  ? "border-[var(--brand)] text-[var(--brand)]"
                  : "border-transparent text-white/50 hover:text-white"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>

        {tab === "bracket" && <Bracket tournament={t} />}
        {tab === "leaderboard" && <Leaderboard tournament={t} />}
        {tab === "scorers" && <TopScorers scorers={t.top_scorers} />}
        {tab === "history" && <MatchHistory matches={finishedMatches} />}
      </motion.div>
    </PageShell>
  );
}

function Bracket({ tournament }) {
  const rounds = {};
  for (const m of tournament.matches || []) {
    rounds[m.round] = rounds[m.round] || [];
    rounds[m.round].push(m);
  }
  const roundKeys = Object.keys(rounds).sort((a, b) => a - b);
  if (!roundKeys.length) {
    return <div className="glass state-panel py-10 text-center text-white/50">Chaves ainda não publicadas.</div>;
  }
  const roundLabel = (idx, total) => {
    if (idx === total - 1) return "Final";
    if (idx === total - 2) return "Semifinais";
    if (idx === total - 3) return "Quartas";
    return `Rodada ${idx + 1}`;
  };

  return (
    <div data-testid={TOURN.bracket} className="overflow-x-auto pb-4 -mx-4 px-4 sm:mx-0 sm:px-0">
      <div className="flex gap-5 sm:gap-8 min-w-fit">
        {roundKeys.map((r, idx) => (
          <div key={r} className="min-w-[240px] sm:min-w-[260px]">
            <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] mb-4 text-center">
              {roundLabel(idx, roundKeys.length)}
            </div>
            <div className="flex flex-col gap-5 sm:gap-6 justify-around h-full">
              {rounds[r].map((m) => (
                <MatchCard key={m.id} m={m} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MatchCard({ m, dense }) {
  const winnerA = m.status === "finished" && m.score_a > m.score_b;
  const winnerB = m.status === "finished" && m.score_b > m.score_a;
  const isTBD = !m.team_a || !m.team_b;
  let when = "";
  try {
    when = new Date(m.scheduled_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  } catch {
    when = "";
  }
  return (
    <motion.div
      data-testid={`match-${m.id}`}
      whileHover={{ scale: 1.02 }}
      className={`glass border ${
        m.status === "live" ? "border-[var(--brand)] shadow-[0_0_24px_rgba(255,107,0,0.15)]" : "border-white/10"
      } ${dense ? "p-3" : "p-4"} relative`}
    >
      <div className="text-[9px] uppercase tracking-[0.35em] text-white/40 mb-2 flex justify-between gap-2">
        <span>{when}</span>
        <span
          style={{
            color:
              m.status === "live" ? "var(--success)" : m.status === "finished" ? "var(--text-2)" : "var(--warning)",
          }}
        >
          {m.status === "live" ? "• Ao vivo" : m.status === "finished" ? "Final" : "Agendado"}
        </span>
      </div>
      <TeamRow team={m.team_a} score={m.team_a ? m.score_a : null} winner={winnerA} tbd={!m.team_a} />
      <div className="h-px bg-white/10 my-2" />
      <TeamRow team={m.team_b} score={m.team_b ? m.score_b : null} winner={winnerB} tbd={!m.team_b} />
      {isTBD && (
        <div className="absolute inset-0 grid place-items-center text-white/30 text-xs uppercase tracking-[0.3em] pointer-events-none bg-black/20">
          aguardando…
        </div>
      )}
    </motion.div>
  );
}

function TeamRow({ team, score, winner, tbd }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${tbd ? "opacity-30" : ""} ${winner ? "" : "text-white/60"}`}>
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xl shrink-0">{team?.crest || "•"}</span>
        <span className={`font-heading uppercase tracking-wide text-base sm:text-lg truncate ${winner ? "text-white" : ""}`}>
          {team?.name || "A definir"}
        </span>
      </div>
      <span className={`font-heading text-xl sm:text-2xl shrink-0 ${winner ? "text-[var(--brand)]" : ""}`}>
        {score ?? "—"}
      </span>
    </div>
  );
}

function Leaderboard({ tournament }) {
  const rows = tournament.standings || [];
  if (!rows.length) {
    return (
      <div className="glass state-panel py-10 text-center text-white/50">
        Sem dados de classificação
        {tournament.format === "knockout" ? " para mata-mata." : " ainda."}
      </div>
    );
  }
  return (
    <div data-testid={TOURN.leaderboard} className="glass overflow-x-auto">
      <div className="min-w-[520px]">
        <div className="grid grid-cols-[48px_1fr_48px_48px_48px_64px_52px] px-3 sm:px-4 py-3 text-[10px] uppercase tracking-[0.3em] text-white/40 border-b border-white/10">
          <div>#</div>
          <div>Time</div>
          <div className="text-center">J</div>
          <div className="text-center">V</div>
          <div className="text-center">D</div>
          <div className="text-center">SG</div>
          <div className="text-right">Pts</div>
        </div>
        {rows.map((r, i) => (
          <motion.div
            key={r.team_id}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }}
            className={`grid grid-cols-[48px_1fr_48px_48px_48px_64px_52px] px-3 sm:px-4 py-3 items-center hover:bg-white/[0.04] transition-colors ${
              i === 0 ? "bg-[var(--warning)]/[0.06]" : ""
            }`}
          >
            <div
              className="font-heading text-xl sm:text-2xl"
              style={{
                color: i === 0 ? "var(--warning)" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "white",
              }}
            >
              {i + 1}
              {i === 0 && <Crown className="inline w-3 h-3 ml-1 text-[var(--warning)]" />}
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xl shrink-0">{r.crest}</span>
              <span className="font-heading uppercase tracking-wide truncate">{r.team_name}</span>
            </div>
            <div className="text-center text-white/70">{r.P}</div>
            <div className="text-center text-[var(--success)]">{r.W}</div>
            <div className="text-center text-[var(--danger)]">{r.L}</div>
            <div className="text-center text-white/80">{r.GD > 0 ? `+${r.GD}` : r.GD}</div>
            <div className="text-right font-heading text-xl sm:text-2xl text-[var(--brand)]">{r.Pts}</div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function TopScorers({ scorers }) {
  if (!scorers?.length) {
    return <div className="glass state-panel py-10 text-center text-white/50">Sem dados de artilharia.</div>;
  }
  return (
    <div data-testid={TOURN.topScorers} className="grid sm:grid-cols-2 gap-3 sm:gap-4">
      {scorers.map((s, i) => (
        <motion.div
          key={`${s.team_id}-${s.player}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 }}
          className="glass p-4 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <div className="font-heading text-3xl sm:text-4xl shrink-0" style={{ color: i === 0 ? "var(--warning)" : "white" }}>
              #{i + 1}
            </div>
            <div className="text-2xl sm:text-3xl shrink-0">{s.crest}</div>
            <div className="min-w-0">
              <div className="font-heading text-lg sm:text-xl uppercase truncate">{s.player}</div>
              <div className="text-xs text-white/50 uppercase tracking-[0.2em] truncate">{s.team_name}</div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-heading text-3xl sm:text-4xl text-[var(--brand)] flex items-center gap-1 justify-end">
              <Goal className="w-5 h-5" />
              {s.goals}
            </div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">gols</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function MatchHistory({ matches }) {
  if (!matches.length) {
    return <div className="glass state-panel py-10 text-center text-white/50">Nenhuma partida finalizada ainda.</div>;
  }
  return (
    <div className="space-y-3">
      {matches
        .slice()
        .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at))
        .map((m) => (
          <div key={m.id} className="glass p-3 sm:p-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
              <span className="text-xl sm:text-2xl shrink-0">{m.team_a?.crest}</span>
              <span className="font-heading text-base sm:text-xl uppercase truncate">{m.team_a?.name}</span>
            </div>
            <div className="font-heading text-2xl sm:text-3xl text-[var(--brand)] px-2 sm:px-6 shrink-0">
              {m.score_a} <span className="text-white/30">-</span> {m.score_b}
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-1 justify-end min-w-0">
              <span className="font-heading text-base sm:text-xl uppercase truncate">{m.team_b?.name}</span>
              <span className="text-xl sm:text-2xl shrink-0">{m.team_b?.crest}</span>
            </div>
          </div>
        ))}
    </div>
  );
}
