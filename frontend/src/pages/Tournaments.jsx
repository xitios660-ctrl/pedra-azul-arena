import React, { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import PageShell from "@/components/PageShell";
import { TOURN } from "@/constants/testIds";
import api from "@/lib/api";
import { Trophy, Goal, Activity, ChevronRight, Crown } from "lucide-react";

function StatusBadge({ status }) {
  const map = {
    live: { label: "Ao Vivo", color: "var(--success)" },
    finished: { label: "Final", color: "var(--text-2)" },
    scheduled: { label: "Agendado", color: "var(--warning)" },
  };
  const v = map[status] || map.scheduled;
  return (
    <span className="text-[10px] uppercase tracking-[0.3em] px-2 py-1 border" style={{ color: v.color, borderColor: v.color }}>
      {v.label}
    </span>
  );
}

export function TournamentsList() {
  const [list, setList] = useState([]);
  useEffect(() => { api.get("/tournaments").then(({ data }) => setList(data)); }, []);
  return (
    <PageShell>
      <div data-testid={TOURN.list} className="max-w-7xl mx-auto px-6 md:px-10 py-12">
        <div className="diagonal-stripe pb-6 mb-10">
          <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2">// Competições</div>
          <h1 className="font-heading text-5xl md:text-7xl uppercase italic leading-[0.9]">
            Campeonatos <span className="text-[var(--brand)]">Ativos</span>
          </h1>
          <p className="text-white/60 mt-2">Brackets cinematográficos, classificações em tempo real e artilharia da temporada.</p>
        </div>

        <div className="grid md:grid-cols-2 gap-6">
          {list.map((t, i) => (
            <motion.div key={t.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Link to={`/tournaments/${t.id}`} data-testid={TOURN.card(t.id)} className="relative block h-[260px] overflow-hidden border border-white/10 hover:border-[var(--brand)] transition-colors group">
                <img src={t.banner} alt="" className="absolute inset-0 w-full h-full object-cover scale-110 group-hover:scale-125 transition-transform duration-700" />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20" />
                <div className="absolute top-4 right-4"><StatusBadge status={t.status} /></div>
                <div className="absolute bottom-0 left-0 right-0 p-6">
                  <div className="text-[11px] uppercase tracking-[0.3em] text-[var(--brand)] mb-2">// {t.format === "knockout" ? "Mata-mata" : "Liga"} · {t.season}</div>
                  <div className="font-heading text-4xl uppercase italic leading-[0.9]">{t.name}</div>
                  <div className="flex items-center gap-4 mt-3 text-white/60 text-sm">
                    <span className="flex items-center gap-1"><Trophy className="w-4 h-4 text-[var(--brand)]" /> {t.teams.length} times</span>
                    <span className="flex items-center gap-1"><Activity className="w-4 h-4 text-[var(--brand)]" /> {t.matches.length} partidas</span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
    </PageShell>
  );
}

export function TournamentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [t, setT] = useState(null);
  const [tab, setTab] = useState("bracket"); // bracket | leaderboard | scorers | history

  useEffect(() => {
    api.get(`/tournaments/${id}`).then(({ data }) => {
      setT(data);
      setTab(data.format === "league" ? "leaderboard" : "bracket");
    }).catch(() => navigate("/tournaments"));
  }, [id, navigate]);

  if (!t) return <PageShell><div className="min-h-[60vh] grid place-items-center text-white/50">Carregando…</div></PageShell>;

  const finishedMatches = t.matches.filter(m => m.status === "finished");

  return (
    <PageShell>
      {/* Hero banner */}
      <div className="relative h-[40vh] overflow-hidden">
        <img src={t.banner} alt="" className="absolute inset-0 w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#030305] via-black/60 to-black/30" />
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute bottom-0 left-0 right-0">
          <div className="max-w-7xl mx-auto px-6 md:px-10 pb-8">
            <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)]">// {t.format === "knockout" ? "Mata-mata" : "Liga"} · {t.season}</div>
            <h1 className="font-heading text-5xl md:text-7xl uppercase italic leading-[0.9] mt-1">{t.name}</h1>
            <div className="mt-3"><StatusBadge status={t.status} /></div>
          </div>
        </div>
      </div>

      <div data-testid={TOURN.detail} className="max-w-7xl mx-auto px-6 md:px-10 py-10">
        {/* Tabs */}
        <div className="flex gap-2 mb-8 border-b border-white/10">
          {[
            t.format === "knockout" && { id: "bracket", label: "Chaves" },
            { id: "leaderboard", label: "Classificação" },
            { id: "scorers", label: "Artilharia" },
            { id: "history", label: "Histórico" },
          ].filter(Boolean).map((it) => (
            <button key={it.id} onClick={() => setTab(it.id)}
              className={`px-4 py-3 font-heading uppercase tracking-[0.2em] text-sm border-b-2 transition-colors ${
                tab === it.id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-white/50 hover:text-white"
              }`}>{it.label}</button>
          ))}
        </div>

        {tab === "bracket" && <Bracket tournament={t} />}
        {tab === "leaderboard" && <Leaderboard tournament={t} />}
        {tab === "scorers" && <TopScorers scorers={t.top_scorers} />}
        {tab === "history" && <MatchHistory matches={finishedMatches} />}
      </div>
    </PageShell>
  );
}

function Bracket({ tournament }) {
  const rounds = {};
  for (const m of tournament.matches) {
    rounds[m.round] = rounds[m.round] || [];
    rounds[m.round].push(m);
  }
  const roundKeys = Object.keys(rounds).sort((a,b) => a - b);
  const roundLabel = (idx, total) => {
    if (idx === total - 1) return "Final";
    if (idx === total - 2) return "Semifinais";
    if (idx === total - 3) return "Quartas";
    return `Rodada ${idx + 1}`;
  };

  return (
    <div data-testid={TOURN.bracket} className="overflow-x-auto pb-4">
      <div className="flex gap-8 min-w-fit">
        {roundKeys.map((r, idx) => (
          <div key={r} className="min-w-[260px]">
            <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] mb-4 text-center">{roundLabel(idx, roundKeys.length)}</div>
            <div className="flex flex-col gap-6 justify-around h-full">
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
  return (
    <motion.div data-testid={`match-${m.id}`} whileHover={{ scale: 1.02 }}
      className={`glass border ${m.status === "live" ? "border-[var(--brand)]" : "border-white/10"} ${dense ? "p-3" : "p-4"} relative`}>
      <div className="text-[9px] uppercase tracking-[0.35em] text-white/40 mb-2 flex justify-between">
        <span>{new Date(m.scheduled_at).toLocaleDateString("pt-BR", {day:"2-digit", month:"2-digit"})}</span>
        <span style={{color: m.status === "live" ? "var(--success)" : "var(--text-3)"}}>{m.status === "live" ? "• Ao Vivo" : m.status === "finished" ? "Final" : "Agendado"}</span>
      </div>
      <TeamRow team={m.team_a} score={m.team_a ? m.score_a : null} winner={winnerA} tbd={!m.team_a} />
      <div className="h-px bg-white/10 my-2" />
      <TeamRow team={m.team_b} score={m.team_b ? m.score_b : null} winner={winnerB} tbd={!m.team_b} />
      {isTBD && <div className="absolute inset-0 grid place-items-center text-white/30 text-xs uppercase tracking-[0.3em] pointer-events-none">aguardando…</div>}
    </motion.div>
  );
}

function TeamRow({ team, score, winner, tbd }) {
  return (
    <div className={`flex items-center justify-between ${tbd ? "opacity-30" : ""} ${winner ? "" : "text-white/60"}`}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{team?.crest || "•"}</span>
        <span className={`font-heading uppercase tracking-wide text-lg ${winner ? "text-white" : ""}`}>{team?.name || "A definir"}</span>
      </div>
      <span className={`font-heading text-2xl ${winner ? "text-[var(--brand)]" : ""}`}>{score ?? "—"}</span>
    </div>
  );
}

function Leaderboard({ tournament }) {
  const rows = tournament.standings || [];
  if (!rows.length) return <div className="text-white/50">Sem dados de classificação para mata-mata.</div>;
  return (
    <div data-testid={TOURN.leaderboard} className="glass overflow-hidden">
      <div className="grid grid-cols-[60px_1fr_60px_60px_60px_80px_60px] px-4 py-3 text-[10px] uppercase tracking-[0.3em] text-white/40 border-b border-white/10">
        <div>#</div><div>Time</div><div className="text-center">J</div><div className="text-center">V</div><div className="text-center">D</div><div className="text-center">SG</div><div className="text-right">Pts</div>
      </div>
      {rows.map((r, i) => (
        <motion.div key={r.team_id}
          initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
          className={`grid grid-cols-[60px_1fr_60px_60px_60px_80px_60px] px-4 py-3 items-center hover:bg-white/[0.04] transition-colors ${i === 0 ? "bg-[var(--warning)]/[0.06]" : ""}`}>
          <div className="font-heading text-2xl" style={{ color: i === 0 ? "var(--warning)" : i === 1 ? "#C0C0C0" : i === 2 ? "#CD7F32" : "white" }}>
            {i + 1}{i === 0 && <Crown className="inline w-3 h-3 ml-1 text-[var(--warning)]" />}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xl">{r.crest}</span>
            <span className="font-heading uppercase tracking-wide">{r.team_name}</span>
          </div>
          <div className="text-center text-white/70">{r.P}</div>
          <div className="text-center text-[var(--success)]">{r.W}</div>
          <div className="text-center text-[var(--danger)]">{r.L}</div>
          <div className="text-center text-white/80">{r.GD > 0 ? `+${r.GD}` : r.GD}</div>
          <div className="text-right font-heading text-2xl text-[var(--brand)]">{r.Pts}</div>
        </motion.div>
      ))}
    </div>
  );
}

function TopScorers({ scorers }) {
  if (!scorers?.length) return <div className="text-white/50">Sem dados de artilharia.</div>;
  return (
    <div data-testid={TOURN.topScorers} className="grid md:grid-cols-2 gap-4">
      {scorers.map((s, i) => (
        <motion.div key={`${s.team_id}-${s.player}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
          className="glass p-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="font-heading text-4xl" style={{ color: i === 0 ? "var(--warning)" : "white" }}>#{i+1}</div>
            <div className="text-3xl">{s.crest}</div>
            <div>
              <div className="font-heading text-xl uppercase">{s.player}</div>
              <div className="text-xs text-white/50 uppercase tracking-[0.2em]">{s.team_name}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="font-heading text-4xl text-[var(--brand)] flex items-center gap-1"><Goal className="w-5 h-5" />{s.goals}</div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">gols</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function MatchHistory({ matches }) {
  if (!matches.length) return <div className="text-white/50">Nenhuma partida finalizada ainda.</div>;
  return (
    <div className="space-y-3">
      {matches.slice().sort((a,b)=> new Date(b.scheduled_at)-new Date(a.scheduled_at)).map((m) => (
        <div key={m.id} className="glass p-4 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1">
            <span className="text-2xl">{m.team_a?.crest}</span>
            <span className="font-heading text-xl uppercase">{m.team_a?.name}</span>
          </div>
          <div className="font-heading text-3xl text-[var(--brand)] px-6">
            {m.score_a} <span className="text-white/30">-</span> {m.score_b}
          </div>
          <div className="flex items-center gap-3 flex-1 justify-end">
            <span className="font-heading text-xl uppercase">{m.team_b?.name}</span>
            <span className="text-2xl">{m.team_b?.crest}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
