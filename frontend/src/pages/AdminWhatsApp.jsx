import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  BellRing,
  Bot,
  CheckCircle2,
  CircleAlert,
  Database,
  Loader2,
  LogOut,
  MessageCircle,
  QrCode,
  RefreshCw,
  Server,
  Wifi,
  WifiOff,
} from "lucide-react";
import PageShell from "@/components/PageShell";
import api, { API_BASE, formatApiErrorDetail } from "@/lib/api";

const EMPTY = {
  status: "DESCONECTADO",
  qr: null,
  number: null,
  last_error: null,
  last_disconnect_reason: null,
  reconnect_attempt: 0,
  has_saved_session: false,
  restoring: false,
  bot: false,
  reminders: false,
};

const STATUS = {
  CONECTADO: { label: "Conectado", color: "var(--success,#22c55e)", tone: "border-emerald-400/35 bg-emerald-400/10" },
  CONECTANDO: { label: "Conectando", color: "var(--brand,#00E5FF)", tone: "border-cyan-400/35 bg-cyan-400/10" },
  AGUARDANDO_QR: { label: "Aguardando QR", color: "#facc15", tone: "border-yellow-400/35 bg-yellow-400/10" },
  ERRO: { label: "Erro", color: "var(--danger,#ef4444)", tone: "border-red-400/35 bg-red-400/10" },
  DESCONECTADO: { label: "Desconectado", color: "#94a3b8", tone: "border-white/15 bg-white/5" },
};

function MiniStatus({ icon, label, value, good }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/25 p-4 min-h-[92px]">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/40">
        {icon}
        {label}
      </div>
      <div className={`mt-3 font-heading text-lg uppercase ${good ? "text-[var(--success)]" : "text-white/75"}`}>
        {value}
      </div>
    </div>
  );
}

export default function AdminWhatsApp() {
  const [state, setState] = useState(EMPTY);
  const [metrics, setMetrics] = useState(null);
  const [health, setHealth] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState(null);
  const eventRef = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) setBusy("refresh");
    try {
      const [st, mt, hl] = await Promise.allSettled([
        api.get("/admin/whatsapp/status"),
        api.get("/admin/metrics"),
        api.get("/health"),
      ]);
      if (st.status === "fulfilled") {
        setState((prev) => ({ ...prev, ...st.value.data }));
        setError("");
      } else if (!quiet) {
        throw st.reason;
      }
      if (mt.status === "fulfilled") setMetrics(mt.value.data);
      if (hl.status === "fulfilled") setHealth(hl.value.data);
      setLastRefresh(new Date());
    } catch (e) {
      setError(formatApiErrorDetail(e?.response?.data?.detail || e?.message));
    } finally {
      if (!quiet) setBusy("");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    load();
    const poll = window.setInterval(() => {
      if (!cancelled) load({ quiet: true });
    }, 3500);

    try {
      const es = new EventSource(`${API_BASE}/admin/whatsapp/events`, { withCredentials: true });
      eventRef.current = es;
      es.onmessage = (ev) => {
        try {
          const next = JSON.parse(ev.data);
          if (next?.status || next?.type === "state") {
            setState((prev) => ({ ...prev, ...next }));
            setError("");
            setLastRefresh(new Date());
          }
        } catch (_) {}
      };
      es.onerror = () => {
        es.close();
        eventRef.current = null;
      };
    } catch (_) {}

    return () => {
      cancelled = true;
      clearInterval(poll);
      eventRef.current?.close?.();
    };
  }, [load]);

  const connect = async () => {
    setBusy("connect");
    setError("");
    try {
      const { data } = await api.post("/admin/whatsapp/start");
      setState((prev) => ({ ...prev, ...data }));
      await load({ quiet: true });
    } catch (e) {
      setError(formatApiErrorDetail(e?.response?.data?.detail || e?.message));
    } finally {
      setBusy("");
    }
  };

  const disconnect = async () => {
    if (!window.confirm("Desconectar o WhatsApp e apagar a sessão salva? Depois será necessário ler um novo QR Code.")) return;
    setBusy("logout");
    setError("");
    try {
      const { data } = await api.post("/admin/whatsapp/logout");
      setState((prev) => ({ ...prev, ...data }));
      await load({ quiet: true });
    } catch (e) {
      setError(formatApiErrorDetail(e?.response?.data?.detail || e?.message));
    } finally {
      setBusy("");
    }
  };

  const meta = STATUS[state.status] || STATUS.DESCONECTADO;
  const restored = Boolean(state.has_saved_session);
  const connected = state.status === "CONECTADO";
  const waitingQr = state.status === "AGUARDANDO_QR" && state.qr;
  const headline = state.status === "CONECTANDO" && (state.restoring || restored)
    ? "Restaurando sessão"
    : meta.label;
  const connectLabel = connected
    ? "Verificar conexão"
    : restored
      ? "Reconectar sessão"
      : "Conectar / gerar QR";

  const lastRefreshLabel = useMemo(() => {
    if (!lastRefresh) return "—";
    return lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }, [lastRefresh]);

  return (
    <PageShell hideWhatsApp>
      <div className="min-h-[calc(100vh-72px)] bg-[var(--bg-base,#030305)] text-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between mb-6">
            <div>
              <Link to="/admin" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-white/45 hover:text-[var(--brand)] transition-colors">
                <ArrowLeft className="w-4 h-4" /> Voltar ao admin
              </Link>
              <div className="mt-4 text-[10px] uppercase tracking-[0.34em] text-[var(--brand)]">Central de integração</div>
              <h1 className="font-heading text-4xl sm:text-5xl uppercase italic mt-1">WhatsApp · Baileys</h1>
              <p className="text-white/50 text-sm mt-2 max-w-2xl">
                Pareamento, reconexão e diagnóstico do WhatsApp da quadra. A sessão fica persistida no MongoDB e o QR nunca é exposto fora do admin.
              </p>
            </div>
            <button type="button" onClick={() => load()} disabled={Boolean(busy)} className="btn-ghost !px-4 !py-2.5 min-h-[44px]">
              {busy === "refresh" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Atualizar
            </button>
          </div>

          {error && (
            <div className="mb-5 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200 flex gap-3" role="alert">
              <CircleAlert className="w-5 h-5 shrink-0 mt-0.5" />
              <div>{error}</div>
            </div>
          )}

          <div className="grid xl:grid-cols-[1.05fr_0.95fr] gap-5">
            <section className="glass rounded-3xl p-5 sm:p-7 overflow-hidden relative">
              <div className="absolute -right-16 -top-20 w-64 h-64 rounded-full blur-3xl opacity-15 bg-[var(--brand)]" />
              <div className="relative">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.26em] text-white/40">Estado da sessão</div>
                    <div className="mt-3 flex items-center gap-3">
                      {connected ? <Wifi className="w-7 h-7" style={{ color: meta.color }} /> : <WifiOff className="w-7 h-7" style={{ color: meta.color }} />}
                      <div>
                        <div className="font-heading text-3xl uppercase" style={{ color: meta.color }}>{headline}</div>
                        <div className="text-xs text-white/35 mt-1">Última leitura: {lastRefreshLabel}</div>
                      </div>
                    </div>
                  </div>
                  <span className={`text-[10px] uppercase tracking-[0.2em] border px-3 py-2 rounded-full ${meta.tone}`}>{state.status}</span>
                </div>

                {state.number && (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-[10px] uppercase tracking-[0.22em] text-white/35">Número conectado</div>
                    <div className="font-mono text-lg mt-1">+{state.number}</div>
                  </div>
                )}

                <div className="mt-5 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <MiniStatus icon={<Database className="w-3.5 h-3.5" />} label="Sessão Mongo" value={restored ? "Salva" : "Não pareada"} good={restored} />
                  <MiniStatus icon={<Bot className="w-3.5 h-3.5" />} label="Bot" value={state.bot ? "Ativo" : "Indisponível"} good={state.bot} />
                  <MiniStatus icon={<BellRing className="w-3.5 h-3.5" />} label="Lembretes" value={state.reminders ? "Ativos" : "Indisponíveis"} good={state.reminders} />
                  <MiniStatus icon={<Server className="w-3.5 h-3.5" />} label="API / DB" value={health?.db === "ok" ? "Online" : "Verificando"} good={health?.db === "ok"} />
                </div>

                {(state.last_error || state.last_disconnect_reason) && (
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-relaxed">
                    {state.last_error && <div className="text-red-300"><strong>Erro:</strong> {state.last_error}</div>}
                    {state.last_disconnect_reason && <div className="text-white/55 mt-1"><strong>Última desconexão:</strong> {state.last_disconnect_reason}</div>}
                    {Number(state.reconnect_attempt || 0) > 0 && <div className="text-white/40 mt-1">Tentativa automática: {state.reconnect_attempt}</div>}
                  </div>
                )}

                <div className="mt-6 flex flex-wrap gap-3">
                  <button type="button" onClick={connect} disabled={Boolean(busy)} className="btn-neon !px-5 !py-3 min-h-[46px]">
                    {busy === "connect" ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    {connectLabel}
                  </button>
                  <button type="button" onClick={disconnect} disabled={Boolean(busy)} className="btn-ghost !px-5 !py-3 min-h-[46px]">
                    {busy === "logout" ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
                    Desconectar e limpar sessão
                  </button>
                </div>

                <div className="mt-6 grid sm:grid-cols-3 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">Reservas hoje</div>
                    <div className="font-heading text-3xl text-[var(--brand)] mt-1">{metrics?.bookings_today ?? 0}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">Fila admin</div>
                    <div className="font-heading text-3xl mt-1">{metrics?.awaiting_admin_count ?? 0}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/35">Status operacional</div>
                    <div className="font-heading text-lg uppercase mt-2" style={{ color: meta.color }}>{metrics?.wa_status || state.status}</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="glass rounded-3xl p-5 sm:p-7 min-h-[520px] flex flex-col">
              {waitingQr ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--brand)] flex items-center gap-2 mb-4"><QrCode className="w-4 h-4" /> Parear aparelho</div>
                  <img src={state.qr} alt="QR Code para conectar o WhatsApp da Pedra Azul Arena" className="w-[min(82vw,360px)] aspect-square bg-white p-4 rounded-2xl border-2 border-[var(--brand)]/40 shadow-[0_0_44px_rgba(0,229,255,0.2)]" />
                  <ol className="mt-5 text-sm text-white/55 space-y-1 text-left max-w-sm list-decimal pl-5">
                    <li>Abra o WhatsApp no celular da arena.</li>
                    <li>Entre em <strong className="text-white">Aparelhos conectados</strong>.</li>
                    <li>Toque em <strong className="text-white">Conectar um aparelho</strong>.</li>
                    <li>Escaneie este QR e aguarde aparecer <strong className="text-[var(--success)]">Conectado</strong>.</li>
                  </ol>
                </div>
              ) : connected ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <CheckCircle2 className="w-20 h-20 text-[var(--success)] mb-5" />
                  <div className="font-heading text-4xl uppercase text-[var(--success)]">WhatsApp conectado</div>
                  <p className="mt-3 text-sm text-white/50 max-w-md leading-relaxed">
                    O bot pode receber mensagens, consultar horários, criar reservas e enviar confirmações conforme as regras já configuradas no sistema.
                  </p>
                  <div className="mt-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4 max-w-md text-left text-xs text-white/55 leading-relaxed">
                    <strong className="text-emerald-300">Não desconecte pelo celular</strong> se quiser preservar a sessão. O MongoDB guarda as credenciais para restaurar a conexão após reinícios.
                  </div>
                </div>
              ) : state.status === "CONECTANDO" ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <Loader2 className="w-14 h-14 animate-spin text-[var(--brand)] mb-5" />
                  <div className="font-heading text-3xl uppercase text-[var(--brand)]">{restored ? "Restaurando sessão" : "Abrindo conexão"}</div>
                  <p className="mt-3 text-sm text-white/45 max-w-sm">{restored ? "Tentando reutilizar a sessão salva sem pedir novo QR." : "Aguardando o Baileys gerar o QR Code."}</p>
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center">
                  <MessageCircle className="w-16 h-16 text-white/20 mb-4" />
                  <div className="font-heading text-3xl uppercase">Pronto para conectar</div>
                  <p className="mt-3 text-sm text-white/45 max-w-sm">Clique em <strong className="text-white">{connectLabel}</strong>. Se não houver sessão salva, o QR aparecerá aqui.</p>
                </div>
              )}

              <div className="mt-6 border-t border-white/10 pt-5">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-white/40"><Activity className="w-3.5 h-3.5" /> Diagnóstico rápido</div>
                <div className="mt-3 grid sm:grid-cols-2 gap-2 text-xs text-white/55">
                  <div className="rounded-xl bg-black/25 border border-white/10 p-3">Sidecar: <strong className="text-white">{health?.whatsapp || state.status}</strong></div>
                  <div className="rounded-xl bg-black/25 border border-white/10 p-3">Sessão: <strong className="text-white">{restored ? "persistida" : "sem credenciais"}</strong></div>
                  <div className="rounded-xl bg-black/25 border border-white/10 p-3">Bot: <strong className="text-white">{state.bot ? "carregado" : "aguardando"}</strong></div>
                  <div className="rounded-xl bg-black/25 border border-white/10 p-3">Reconnect: <strong className="text-white">{state.reconnect_attempt || 0}</strong></div>
                </div>
                <p className="mt-4 text-[11px] text-white/35 leading-relaxed">
                  Observação: no plano Free do Render o serviço pode dormir. A sessão fica salva, mas conexão 24/7 depende de uma instância que não seja suspensa.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </PageShell>
  );
}
