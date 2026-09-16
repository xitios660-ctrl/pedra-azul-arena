import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import PageShell from "@/components/PageShell";
import api, { API_BASE } from "@/lib/api";
import { useSiteSettings } from "@/lib/SiteSettings";
import { ADMIN } from "@/constants/testIds";
import {
  TrendingUp, CheckCircle2, Hourglass, Activity, DollarSign, BarChart3, Save,
  Eye, MessageCircle, FileCheck, Wifi, WifiOff, QrCode, RefreshCw, LogOut, Loader2,
  Calendar, Clock, Ticket, X, Settings, AlertCircle, Download, Search
} from "lucide-react";
import { isWhatsAppPlaceholder, isPixKeyPlaceholder, OPEN_DAY_LABELS } from "@/lib/siteConfig";
import AdminCalendar from "@/components/AdminCalendar";
import RescheduleModal from "@/components/RescheduleModal";

function fmtBRL(n) { return (n || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }

const STATUS_COLORS = {
  pending: "var(--warning)",
  awaiting_admin: "var(--brand)",
  confirmed: "var(--success)",
  cancelled: "var(--danger)",
  expired: "var(--text-3)",
  no_show: "var(--warning)",
};
const STATUS_LABEL = {
  pending: "Aguardando PIX",
  awaiting_admin: "Informado (validar)",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  expired: "Expirado",
  no_show: "No-show",
};

function bookingStartIsPast(b) {
  if (!b?.date || !b?.start_time) return false;
  const [hh, mm] = String(b.start_time).split(":").map((x) => parseInt(x, 10) || 0);
  const start = new Date(`${b.date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00`);
  return !Number.isNaN(start.getTime()) && start.getTime() <= Date.now();
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [bookings, setBookings] = useState([]);
  const [tournaments, setTournaments] = useState([]);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedTour, setSelectedTour] = useState(null);
  const [waModal, setWaModal] = useState(null);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);

  const refresh = async () => {
    const [s, b, t] = await Promise.all([
      api.get("/admin/dashboard"),
      api.get("/admin/bookings"),
      api.get("/tournaments"),
    ]);
    setStats(s.data); setBookings(b.data); setTournaments(t.data);
    if (!selectedTour && t.data.length) setSelectedTour(t.data[0]);
  };

  useEffect(() => {
    refresh();
    // Mount-only load; refresh closes over selectedTour intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmAndPrepareWhatsapp = async (id) => {
    const { data } = await api.post(`/admin/bookings/${id}/confirm`);
    setWaModal(data); // contains whatsapp_link + whatsapp_message
    refresh();
  };
  const markWhatsappSent = async (id) => {
    await api.post(`/admin/bookings/${id}/whatsapp_sent`);
    setWaModal(null);
    refresh();
  };
  const cancelBooking = async (id) => {
    if (!window.confirm("Cancelar esta reserva?")) return;
    await api.post(`/admin/bookings/${id}/cancel`);
    refresh();
  };
  const rejectBooking = async (id) => {
    if (!window.confirm("Recusar comprovante / rejeitar PIX? A reserva será cancelada (sem auto-confirmação).")) return;
    await api.post(`/admin/bookings/${id}/reject`);
    refresh();
  };
  const markNoShow = async (id) => {
    if (!window.confirm("Marcar esta reserva como no-show (cliente não compareceu)?")) return;
    try {
      await api.post(`/admin/bookings/${id}/no-show`);
      refresh();
    } catch (e) {
      window.alert(e.response?.data?.detail || e.message || "Não foi possível marcar no-show");
    }
  };

  return (
    <PageShell hideWhatsApp>
      <div data-testid={ADMIN.page} className="max-w-7xl mx-auto px-6 md:px-10 py-12">
        <div className="diagonal-stripe pb-6 mb-8">
          <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2">// Control Room</div>
          <h1 className="font-heading text-5xl md:text-7xl uppercase italic leading-[0.9]">
            Admin <span className="text-[var(--brand)]">Dashboard</span>
          </h1>
          <p className="text-white/60 mt-2">Gestão completa da arena, reservas e campeonatos em tempo real.</p>
        </div>

        <AdminOnboardingChecklist onGoTab={setActiveTab} />

        <div className="flex gap-1 sm:gap-2 mb-8 border-b border-white/10 overflow-x-auto scrollbar-none -mx-2 px-2">
          {[
            { id: "dashboard", label: "Visão Geral" },
            { id: "bookings", label: "Reservas" },
            { id: "calendar", label: "Calendário" },
            { id: "whatsapp", label: "WhatsApp" },
            { id: "settings", label: "Configurações" },
            { id: "tournaments", label: "Campeonatos" },
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)}
              className={`px-3 sm:px-5 py-3 font-heading uppercase tracking-[0.15em] sm:tracking-[0.2em] text-xs sm:text-sm border-b-2 transition-colors whitespace-nowrap shrink-0 ${
                activeTab === t.id ? "border-[var(--brand)] text-[var(--brand)]" : "border-transparent text-white/50 hover:text-white"
              }`}>{t.label}</button>
          ))}
        </div>

        {activeTab === "dashboard" && !stats && (
          <div className="grid md:grid-cols-4 gap-4 mb-8" aria-busy="true" aria-label="Carregando dashboard">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton-card h-28" />)}
          </div>
        )}
        {activeTab === "dashboard" && stats && (
          <DashboardView stats={stats} bookings={bookings}
            onConfirm={confirmAndPrepareWhatsapp}
            onReject={rejectBooking} />
        )}
        {activeTab === "bookings" && (
          <BookingsAdmin bookings={bookings}
            onConfirm={confirmAndPrepareWhatsapp}
            onCancel={cancelBooking}
            onReject={rejectBooking}
            onNoShow={markNoShow}
            onReschedule={(b) => setRescheduleTarget(b)} />
        )}
        {activeTab === "calendar" && <AdminCalendar />}
        {activeTab === "whatsapp" && <WhatsAppAdmin />}
        {activeTab === "settings" && <SiteSettingsAdmin />}
        {activeTab === "tournaments" && (
          <TournamentsAdmin tournaments={tournaments} selected={selectedTour} setSelected={setSelectedTour} onUpdated={refresh} />
        )}
      </div>

      {/* WhatsApp Confirmation Modal */}
      {rescheduleTarget && (
        <RescheduleModal
          booking={rescheduleTarget}
          mode="admin"
          onClose={() => setRescheduleTarget(null)}
          onDone={() => { setRescheduleTarget(null); refresh(); }}
        />
      )}

      {waModal && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md grid place-items-center p-4" onClick={() => setWaModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glass-strong w-[min(640px,95vw)] p-8">
            <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] flex items-center gap-2">
              <MessageCircle className="w-3 h-3" /> Enviar Confirmação WhatsApp
            </div>
            <h2 className="font-heading text-3xl uppercase italic mt-1">
              {waModal.whatsapp_auto ? "Confirmação enviada via Baileys" : "Quase pronto — clique para enviar"}
            </h2>
            <p className="text-white/60 text-sm mt-2">
              Para <span className="text-white">{waModal.customer_name}</span> · WhatsApp <span className="font-mono">+{waModal.whatsapp}</span>
              {waModal.whatsapp_auto && <span className="ml-2 text-[var(--success)]">· Auto-enviado</span>}
            </p>
            <pre className="mt-4 p-4 bg-black/50 border border-white/10 text-xs text-white/80 whitespace-pre-wrap font-mono leading-relaxed">{waModal.whatsapp_message}</pre>
            <div className="mt-6 flex items-center gap-3">
              {!waModal.whatsapp_auto && (
                <a
                  data-testid={ADMIN.sendWhatsapp(waModal.id)}
                  href={waModal.whatsapp_link}
                  target="_blank" rel="noopener noreferrer"
                  onClick={() => markWhatsappSent(waModal.id)}
                  className="btn-neon flex-1 justify-center"
                >
                  <MessageCircle className="w-4 h-4" /> Abrir WhatsApp e enviar
                </a>
              )}
              {waModal.whatsapp_auto && (
                <button onClick={() => { markWhatsappSent(waModal.id); }} className="btn-neon flex-1 justify-center">
                  <CheckCircle2 className="w-4 h-4" /> OK
                </button>
              )}
              <button onClick={() => setWaModal(null)} className="btn-ghost">Fechar</button>
            </div>
            <div className="mt-3 text-[10px] uppercase tracking-[0.3em] text-white/40">
              Ao clicar, abrimos o WhatsApp com a mensagem pronta. A reserva já está confirmada.
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}



const ONBOARDING_DISMISS_KEY = "pedra_admin_onboarding_dismissed";

function AdminOnboardingChecklist({ onGoTab }) {
  const { settings } = useSiteSettings();
  const [waStatus, setWaStatus] = useState(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem(ONBOARDING_DISMISS_KEY) === "1";
    } catch (_) {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get("/admin/whatsapp/status");
        if (!cancelled) setWaStatus(data?.status || "DESCONECTADO");
      } catch (_) {
        if (!cancelled) setWaStatus("DESCONECTADO");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const items = [];
  if (waStatus && waStatus !== "CONECTADO") {
    items.push({
      id: "wa",
      title: "Conectar WhatsApp (Baileys)",
      hint: waStatus === "AGUARDANDO_QR"
        ? "QR pronto — escaneie na aba WhatsApp."
        : waStatus === "CONECTANDO"
          ? "Restaurando sessão WhatsApp após cold start…"
          : `Status: ${waStatus}. Abra a aba WhatsApp e gere o QR.`,
      tab: "whatsapp",
      cta: "Abrir WhatsApp",
    });
  }
  if (isWhatsAppPlaceholder(settings)) {
    items.push({
      id: "phone",
      title: "Definir WhatsApp público",
      hint: "Número ainda é o placeholder (4002-8922). Atualize em Configurações.",
      tab: "settings",
      cta: "Configurações",
    });
  }
  if (isPixKeyPlaceholder(settings)) {
    items.push({
      id: "pix",
      title: "Definir chave PIX real",
      hint: "PIX ainda está no e-mail seed. Clientes precisam da chave correta.",
      tab: "settings",
      cta: "Configurações",
    });
  }

  if (dismissed || items.length === 0 || waStatus === null) return null;

  const dismiss = () => {
    try { sessionStorage.setItem(ONBOARDING_DISMISS_KEY, "1"); } catch (_) {}
    setDismissed(true);
  };

  return (
    <div
      data-testid="admin-onboarding-checklist"
      className="mb-8 glass p-5 border border-[var(--brand)]/35 relative overflow-hidden"
      role="region"
      aria-label="Checklist de preparação do painel"
    >
      <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-[var(--brand)]/10 blur-3xl pointer-events-none" />
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5" /> Primeiros passos
          </div>
          <h2 className="font-heading text-2xl md:text-3xl uppercase italic mt-1 leading-none">
            Prepare a arena <span className="text-[var(--brand)]">antes do público</span>
          </h2>
          <p className="text-white/50 text-sm mt-2 max-w-xl">
            Checklist rápido — some itens ao configurar. Pode dispensar nesta sessão; volta no próximo login se ainda incompleto.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="text-white/40 hover:text-white p-2 shrink-0"
          aria-label="Dispensar checklist nesta sessão"
          data-testid="admin-onboarding-dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="space-y-2">
        {items.map((it) => (
          <li
            key={it.id}
            className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-black/35 border border-white/10"
            data-testid={`admin-onboarding-item-${it.id}`}
          >
            <div className="flex-1 min-w-0">
              <div className="font-heading text-lg uppercase tracking-wide text-white">{it.title}</div>
              <div className="text-xs text-white/50 mt-0.5">{it.hint}</div>
            </div>
            <button
              type="button"
              onClick={() => onGoTab?.(it.tab)}
              className="btn-ghost !py-2 !px-4 !text-xs shrink-0 inline-flex items-center gap-2"
            >
              {it.tab === "settings" ? <Settings className="w-3.5 h-3.5" /> : <MessageCircle className="w-3.5 h-3.5" />}
              {it.cta}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}


const WA_STATUS_STYLE = {
  DESCONECTADO: { color: "var(--danger)", label: "DESCONECTADO" },
  CONECTANDO: { color: "var(--warning)", label: "CONECTANDO" },
  AGUARDANDO_QR: { color: "var(--brand)", label: "AGUARDANDO_QR" },
  CONECTADO: { color: "var(--success)", label: "CONECTADO" },
  ERRO: { color: "var(--danger)", label: "ERRO" },
};

function WhatsAppAdmin() {
  const [state, setState] = useState({ status: "DESCONECTADO", qr: null, number: null });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    let es;
    let cancelled = false;
    const connect = async () => {
      try {
        const { data } = await api.get("/admin/whatsapp/status");
        if (!cancelled) setState(data);
      } catch (e) {
        if (!cancelled) setErr("Não foi possível ler status do WhatsApp.");
      }
      try {
        const { data } = await api.get("/admin/metrics");
        if (!cancelled) setMetrics(data);
      } catch (_) {}
      // Prefer cookie-auth SSE via fetch stream is complex; use EventSource with credentials
      try {
        es = new EventSource(`${API_BASE}/admin/whatsapp/events`, { withCredentials: true });
        es.onmessage = (ev) => {
          try {
            const data = JSON.parse(ev.data);
            if (data.type === "state" || data.status) {
              setState((prev) => ({ ...prev, ...data }));
              setErr("");
            }
          } catch (_) {}
        };
        es.onerror = () => {
          // EventSource may fail if auth via cookie works but some proxies buffer —
          // fall back to polling
          es?.close();
          es = null;
        };
      } catch (_) {}
    };
    connect();
    const poll = setInterval(async () => {
      try {
        const { data } = await api.get("/admin/whatsapp/status");
        if (!cancelled) setState(data);
      } catch (_) {}
      try {
        const { data } = await api.get("/admin/metrics");
        if (!cancelled) setMetrics(data);
      } catch (_) {}
    }, 4000);
    return () => {
      cancelled = true;
      clearInterval(poll);
      es?.close();
    };
  }, []);

  const start = async () => {
    setBusy(true); setErr("");
    try {
      const { data } = await api.post("/admin/whatsapp/start");
      setState(data);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };
  const logout = async () => {
    if (!window.confirm("Desconectar WhatsApp e limpar sessão?")) return;
    setBusy(true); setErr("");
    try {
      const { data } = await api.post("/admin/whatsapp/logout");
      setState(data);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally { setBusy(false); }
  };

  const st = WA_STATUS_STYLE[state.status] || WA_STATUS_STYLE.DESCONECTADO;

  return (
    <div data-testid="admin-whatsapp-panel" className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4 sm:gap-6">
      <div className="glass p-6">
        <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] mb-2 flex items-center gap-2">
          <MessageCircle className="w-4 h-4" /> Baileys · Sessão WhatsApp
        </div>
        <h2 className="font-heading text-4xl uppercase italic">Conexão</h2>
        <div className="mt-6 flex items-center gap-3">
          {state.status === "CONECTADO" ? (
            <Wifi className="w-6 h-6" style={{ color: st.color }} />
          ) : (
            <WifiOff className="w-6 h-6" style={{ color: st.color }} />
          )}
          <span
            data-testid="admin-whatsapp-status"
            className="text-sm uppercase tracking-[0.25em] px-3 py-1.5 border font-heading"
            style={{ color: st.color, borderColor: st.color }}
            role="status"
            aria-live="polite"
          >
            {state.status === "CONECTANDO" && (state.restoring || state.has_saved_session)
              ? "RESTAURANDO SESSÃO"
              : st.label}
          </span>
        </div>
        {state.number && (
          <div className="mt-4 text-white/70">
            Número conectado: <span className="font-mono text-white">+{state.number}</span>
          </div>
        )}
        {state.last_error && (
          <div className="mt-3 text-sm text-[var(--danger)] border-l-2 border-[var(--danger)] pl-3">{state.last_error}</div>
        )}
        {state.last_disconnect_reason && state.status !== "CONECTADO" && (
          <div className="mt-2 text-xs text-white/40 uppercase tracking-[0.2em]">
            Último disconnect: {state.last_disconnect_reason}
          </div>
        )}
        {err && <div className="mt-3 text-sm text-[var(--danger)]">{err}</div>}
        <div className="mt-8 flex flex-wrap gap-3">
          <button type="button" data-testid="admin-whatsapp-start" onClick={start} disabled={busy}
            className="btn-neon !py-2 !px-4 !text-sm min-h-[44px]"
            aria-label="Conectar WhatsApp e gerar QR Code">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <RefreshCw className="w-4 h-4" aria-hidden />}
            Conectar / Gerar QR
          </button>
          <button type="button" data-testid="admin-whatsapp-logout" onClick={logout} disabled={busy}
            className="btn-ghost !py-2 !px-4 !text-sm min-h-[44px]"
            aria-label="Desconectar WhatsApp e limpar sessão">
            <LogOut className="w-4 h-4" aria-hidden /> Desconectar
          </button>
        </div>
        <p className="mt-6 text-xs text-white/45 leading-relaxed max-w-lg">
          Escaneie o QR com o WhatsApp do celular (Aparelhos conectados). A sessão é salva no MongoDB
          e sobrevive a reinícios no Render. Credenciais nunca vão para o frontend.
        </p>
        {metrics && (
          <div className="mt-5 grid grid-cols-3 gap-2 text-center" data-testid="admin-ops-metrics">
            <div className="glass p-3">
              <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">Reservas hoje</div>
              <div className="font-heading text-2xl text-[var(--brand)]">{metrics.bookings_today ?? 0}</div>
            </div>
            <div className="glass p-3">
              <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">WA status</div>
              <div className="font-heading text-sm mt-1" style={{ color: st.color }}>{metrics.wa_status || state.status}</div>
            </div>
            <div className="glass p-3">
              <div className="text-[9px] uppercase tracking-[0.2em] text-white/40">Last error</div>
              <div className="text-[11px] text-white/60 mt-1 break-all">{metrics.last_error_code || "—"}</div>
            </div>
          </div>
        )}
        {metrics?.last_7_days?.series?.length > 0 && (
          <div className="mt-4 p-3 bg-black/30 border border-white/10" data-testid="admin-funnel-7d">
            <div className="text-[10px] uppercase tracking-[0.3em] text-white/40 mb-2">Funil / ocupação · 7 dias (Mongo)</div>
            <div className="grid grid-cols-4 gap-2 text-center text-xs">
              <div><div className="text-white/40">Criadas</div><div className="font-heading text-lg text-[var(--brand)]">{metrics.last_7_days.totals?.bookings_created ?? 0}</div></div>
              <div><div className="text-white/40">Confirmadas</div><div className="font-heading text-lg text-[var(--success)]">{metrics.last_7_days.totals?.bookings_confirmed ?? 0}</div></div>
              <div><div className="text-white/40">Canceladas</div><div className="font-heading text-lg text-[var(--danger)]">{metrics.last_7_days.totals?.bookings_cancelled ?? 0}</div></div>
              <div><div className="text-white/40">Horas ocup.</div><div className="font-heading text-lg">{metrics.last_7_days.totals?.occupancy_hours ?? 0}</div></div>
            </div>
            {metrics.awaiting_admin_count > 0 && (
              <div className="mt-2 text-[11px] text-[var(--brand)]">{metrics.awaiting_admin_count} informado(s) na fila</div>
            )}
          </div>
        )}
        <details className="mt-6 group">
          <summary className="cursor-pointer text-[11px] uppercase tracking-[0.25em] text-[var(--brand)] list-none flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" /> Troubleshooting WhatsApp
          </summary>
          <ul className="mt-3 text-xs text-white/55 leading-relaxed space-y-2 list-disc pl-5 max-w-lg">
            <li>QR não aparece: só deve surgir se não houver sessão no Mongo (ou após logout). Aguarde <strong className="text-white">Restaurando sessão…</strong> no cold start.</li>
            <li>Fica em CONECTANDO / Restaurando: normal após Free sleep — backoff reconecta; reinicie no Render se passar de ~2 min.</li>
            <li>Desconectou sozinho: clique Conectar de novo — sessão no Mongo costuma restaurar sem QR.</li>
            <li>Render Free dorme o serviço: WhatsApp cai; plano pago é necessário para 24/7.</li>
            <li>loggedOut / ERRO: use <strong className="text-white">Desconectar</strong> (limpa sessão) e gere QR novo no celular.</li>
            <li>Bot não responde: health deve mostrar whatsapp CONECTADO; mensagens de grupo são ignoradas.</li>
            <li>Nunca compartilhe QR ou dump de <code className="text-white/70">whatsapp_auth</code>.</li>
          </ul>
        </details>
      </div>

      <div className="glass p-4 sm:p-6 flex flex-col items-center justify-center min-h-[380px] sm:min-h-[420px]">
        {state.status === "AGUARDANDO_QR" && state.qr ? (
          <>
            <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] mb-4 flex items-center gap-2">
              <QrCode className="w-4 h-4" /> Escaneie o QR
            </div>
            <img
              data-testid="admin-whatsapp-qr"
              src={state.qr}
              alt="QR Code para parear WhatsApp da arena. Escaneie em Aparelhos conectados."
              role="img"
              aria-describedby="wa-qr-help"
              className="w-[min(92vw,340px)] h-[min(92vw,340px)] sm:w-[360px] sm:h-[360px] max-w-full bg-white p-3 sm:p-4 border-2 border-[var(--brand)]/50 shadow-[0_0_32px_rgba(0,229,255,0.25)]"
            />
            <p id="wa-qr-help" className="mt-4 text-sm text-white/60 text-center max-w-sm leading-relaxed px-2">
              Abra o WhatsApp no celular → <strong className="text-white">Aparelhos conectados</strong> → escanear este QR.
              Aproxime a câmera; o código renova se expirar — clique em Conectar de novo.
            </p>
          </>
        ) : state.status === "CONECTADO" ? (
          <div className="text-center">
            <CheckCircle2 className="w-16 h-16 text-[var(--success)] mx-auto mb-4" />
            <div className="font-heading text-3xl uppercase text-[var(--success)]">Conectado</div>
            <p className="text-white/50 text-sm mt-2">Confirmações de reserva serão enviadas automaticamente.</p>
          </div>
        ) : state.status === "CONECTANDO" ? (
          <div className="text-center text-white/60" data-testid="admin-whatsapp-restoring">
            <Loader2 className="w-10 h-10 animate-spin text-[var(--brand)] mx-auto mb-3" />
            <div className="font-heading text-xl uppercase text-[var(--brand)]">
              {state.restoring || state.has_saved_session ? "Restaurando sessão…" : "Conectando…"}
            </div>
            <p className="text-sm text-white/45 mt-2 max-w-xs mx-auto leading-relaxed">
              {state.restoring || state.has_saved_session
                ? "Sessão salva no Mongo — tentando reconectar sem novo QR após o cold start."
                : "Aguardando o sidecar Baileys…"}
            </p>
          </div>
        ) : (
          <div className="text-center text-white/50 max-w-xs">
            <QrCode className="w-12 h-12 mx-auto mb-3 opacity-40" />
            Clique em <strong className="text-white">Conectar / Gerar QR</strong> para parear o WhatsApp da arena.
          </div>
        )}
      </div>
    </div>
  );
}


function KPI({ icon, label, value, accent = "var(--brand)", testId }) {
  return (
    <div data-testid={testId} className="glass p-5 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl opacity-15" style={{ background: accent }} />
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-white/40">
        <span>{label}</span>{icon}
      </div>
      <div className="font-heading text-5xl mt-2" style={{ color: accent }}>{value}</div>
    </div>
  );
}

function DashboardView({ stats, bookings = [], onConfirm, onReject }) {
  const maxRev = Math.max(1, ...(stats.revenue_series || []).map(d => d.revenue));
  const awaiting = (bookings || []).filter((b) => b.status === "awaiting_admin");
  const next = stats.next_upcoming;
  const topTimes = stats.top_times || [];
  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-8">
        <KPI testId={ADMIN.kpiTodayBookings} icon={<Ticket className="w-4 h-4 text-[var(--brand)]" />} label="Reservas hoje" value={stats.today_bookings_count ?? 0} />
        <KPI testId={ADMIN.kpiFreeSlots} icon={<Clock className="w-4 h-4 text-[var(--success)]" />} label="Livres hoje" value={`${stats.free_slots_today ?? "—"}/${stats.total_slots_today ?? "—"}`} accent="var(--success)" />
        <KPI testId={ADMIN.kpiMonthRevenue} icon={<DollarSign className="w-4 h-4 text-[var(--brand)]" />} label={`Receita mês (${stats.month || "—"})`} value={fmtBRL(stats.month_revenue_estimate)} />
        <KPI testId={ADMIN.kpiOccupancy} icon={<TrendingUp className="w-4 h-4 text-[var(--success)]" />} label="Ocupação hoje" value={`${stats.occupancy_today_pct}%`} accent="var(--success)" />
        <KPI testId={ADMIN.kpiConfirmed} icon={<CheckCircle2 className="w-4 h-4 text-[var(--success)]" />} label="Confirmadas (total)" value={stats.confirmed_bookings} accent="var(--success)" />
        <KPI testId={ADMIN.kpiAwaiting} icon={<Hourglass className="w-4 h-4 text-[var(--brand)]" />} label="Informados (fila)" value={stats.awaiting_admin_bookings || awaiting.length || 0} accent="var(--brand)" />
        <KPI testId={ADMIN.kpiNoShow} icon={<AlertCircle className="w-4 h-4 text-[var(--warning)]" />} label="No-shows (total)" value={stats.no_show_bookings || 0} accent="var(--warning)" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-8">
        <div data-testid={ADMIN.kpiNextUpcoming} className="glass p-5">
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4" /> Próxima reserva
          </div>
          {!next ? (
            <p className="text-white/50 text-sm">Nenhuma reserva futura ativa.</p>
          ) : (
            <div>
              <div className="font-heading text-3xl uppercase italic text-white">
                {next.date?.slice(8, 10)}/{next.date?.slice(5, 7)} · {next.start_time}
              </div>
              <div className="text-white/70 mt-1">{next.customer_name || "—"}</div>
              <div className="text-[10px] uppercase tracking-[0.25em] mt-2" style={{ color: STATUS_COLORS[next.status] || "var(--brand)" }}>
                {STATUS_LABEL[next.status] || next.status}
                {next.deposit != null ? ` · ${fmtBRL(next.deposit)}` : ""}
              </div>
            </div>
          )}
        </div>
        <div className="glass p-5">
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4" /> Receita PIX acumulada
          </div>
          <div className="font-heading text-4xl text-[var(--brand)]" data-testid={ADMIN.kpiRevenue}>
            {fmtBRL(stats.revenue_deposits)}
          </div>
          <p className="text-white/40 text-xs mt-2">Soma de calções confirmados (histórico).</p>
        </div>
      </div>

      <AwaitingPixQueue
        bookings={awaiting}
        onConfirm={onConfirm}
        onReject={onReject}
      />


      <div className="grid lg:grid-cols-[1.5fr_1fr] gap-6">
        <div className="glass p-6">
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" /> Receita (últimos 7 dias)
          </div>
          <div className="flex items-end gap-3 h-48">
            {(stats.revenue_series || []).map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center gap-2 group">
                <div className="text-[10px] text-white/50 group-hover:text-[var(--brand)]">{fmtBRL(d.revenue)}</div>
                <div className="w-full bg-gradient-to-t from-[var(--brand)]/30 to-[var(--brand)] border-t border-[var(--brand)] transition-all"
                  style={{ height: `${(d.revenue / maxRev) * 100}%`, minHeight: 4 }} />
                <div className="text-[10px] uppercase tracking-[0.2em] text-white/40">{d.date.slice(8,10)}/{d.date.slice(5,7)}</div>
              </div>
            ))}
          </div>
        </div>
        <div className="glass p-6" data-testid={ADMIN.kpiTopHours}>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] mb-4 flex items-center gap-2">
            <Activity className="w-4 h-4" /> Horários mais alugados
          </div>
          {topTimes.length === 0 ? (
            <div className="text-white/40 text-sm">Sem dados ainda.</div>
          ) : topTimes.map((t) => {
            const max = topTimes[0].count;
            return (
              <div key={t.time} className="flex items-center gap-3 mb-3">
                <div className="font-heading text-2xl w-16">{t.time}</div>
                <div className="flex-1 h-2 bg-white/5">
                  <div className="h-full bg-gradient-to-r from-[var(--brand)] to-[#00FFAA]" style={{ width: `${(t.count / max) * 100}%` }} />
                </div>
                <div className="text-white/60 text-sm">{t.count}</div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function BookingsAdmin({ bookings, onConfirm, onCancel, onReject, onNoShow, onReschedule }) {
  const awaitingCount = bookings.filter((b) => b.status === "awaiting_admin").length;
  const [filter, setFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);
  const [autoFocused, setAutoFocused] = useState(false);
  useEffect(() => {
    if (!autoFocused && awaitingCount > 0) {
      setFilter("awaiting_admin");
      setAutoFocused(true);
    }
  }, [awaitingCount, autoFocused]);

  const needle = search.trim().toLowerCase();
  const digits = search.replace(/\D/g, "");
  const filtered = bookings.filter((b) => {
    if (filter !== "all" && b.status !== filter) return false;
    if (dateFrom && (b.date || "") < dateFrom) return false;
    if (dateTo && (b.date || "") > dateTo) return false;
    if (needle) {
      const name = (b.customer_name || "").toLowerCase();
      const wa = String(b.whatsapp || "");
      const hitName = name.includes(needle);
      const hitPhone = wa.includes(needle) || (digits && wa.includes(digits));
      if (!hitName && !hitPhone) return false;
    }
    return true;
  });

  const hasActiveFilters = filter !== "all" || dateFrom || dateTo || needle;
  const clearFilters = () => {
    setFilter("all");
    setDateFrom("");
    setDateTo("");
    setSearch("");
  };

  const exportCsv = async () => {
    setExporting(true);
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("status", filter);
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      if (search.trim()) params.set("q", search.trim());
      const qs = params.toString();
      const url = `${API_BASE}/admin/bookings/export.csv${qs ? `?${qs}` : ""}`;
      const token = localStorage.getItem("arena_token");
      const res = await fetch(url, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "pedra-azul-reservas.csv";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      window.alert("Não foi possível exportar o CSV. Tente novamente.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <AwaitingPixQueue
        bookings={bookings.filter((b) => b.status === "awaiting_admin")}
        onConfirm={onConfirm}
        onReject={onReject}
      />

      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40 block mb-1">De</label>
            <input
              data-testid={ADMIN.bookingsDateFrom}
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-black/40 border border-white/15 px-3 py-2 text-sm text-white focus:border-[var(--brand)] focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40 block mb-1">Até</label>
            <input
              data-testid={ADMIN.bookingsDateTo}
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-black/40 border border-white/15 px-3 py-2 text-sm text-white focus:border-[var(--brand)] focus:outline-none"
            />
          </div>
          <div className="min-w-[200px]">
            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40 block mb-1">Buscar</label>
            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
              <input
                data-testid={ADMIN.bookingsSearch}
                type="search"
                placeholder="Nome ou WhatsApp"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-black/40 border border-white/15 pl-9 pr-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-[var(--brand)] focus:outline-none"
              />
            </div>
          </div>
        </div>
        <button
          type="button"
          data-testid={ADMIN.exportCsv}
          onClick={exportCsv}
          disabled={exporting}
          className="px-4 py-2 text-[11px] uppercase tracking-[0.2em] border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)]/15 disabled:opacity-50 flex items-center gap-2 shrink-0"
        >
          {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Exportar CSV
        </button>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {[
          { id: "all", label: "Todas" },
          { id: "awaiting_admin", label: `Informados (${awaitingCount})`, color: "var(--brand)" },
          { id: "pending", label: "Pendentes" },
          { id: "confirmed", label: "Confirmadas" },
          { id: "no_show", label: "No-shows", color: "var(--warning)" },
          { id: "cancelled", label: "Canceladas" },
          { id: "expired", label: "Expiradas" },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)}
            className={`px-3 py-1 text-[11px] uppercase tracking-[0.2em] border ${filter === f.id
              ? "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand)]/10"
              : "border-white/15 text-white/60 hover:border-white/40"}`}
            style={f.color && filter === f.id ? { borderColor: f.color, color: f.color } : {}}>
            {f.label}
          </button>
        ))}
        {hasActiveFilters && (
          <button type="button" onClick={clearFilters}
            className="px-3 py-1 text-[11px] uppercase tracking-[0.2em] border border-white/20 text-white/50 hover:text-white hover:border-white/40">
            Limpar filtros
          </button>
        )}
      </div>

      <div className="text-[11px] text-white/40 mb-2 uppercase tracking-[0.2em]">
        {filtered.length} reserva{filtered.length === 1 ? "" : "s"}
        {hasActiveFilters ? " · filtros ativos" : ""}
      </div>

      <div className="glass overflow-x-auto">
        <div className="min-w-[1100px] grid grid-cols-[160px_220px_1fr_100px_140px_120px_220px] px-4 py-3 text-[10px] uppercase tracking-[0.3em] text-white/40 border-b border-white/10">
          <div>Data / Hora</div><div>Cliente</div><div>Partida</div><div>CPF</div><div>WhatsApp</div><div>Status</div><div>Ações</div>
        </div>
        {filtered.length === 0 ? (
          <div data-testid={ADMIN.bookingsEmpty} className="p-10 text-center text-white/50">
            {bookings.length === 0 ? (
              <>
                <Ticket className="w-10 h-10 mx-auto mb-3 text-[var(--brand)]/50" />
                <div className="font-heading text-2xl uppercase text-white/70">Nenhuma reserva ainda</div>
                <p className="text-sm mt-2 max-w-md mx-auto">
                  Quando clientes reservarem pelo site ou WhatsApp, elas aparecem aqui. Use o Calendário para bloquear horários ou criar reservas manuais.
                </p>
              </>
            ) : (
              <>
                <Search className="w-10 h-10 mx-auto mb-3 text-[var(--brand)]/50" />
                <div className="font-heading text-2xl uppercase text-white/70">Nenhuma reserva neste filtro</div>
                <p className="text-sm mt-2 max-w-sm mx-auto">
                  Ajuste datas, status ou busca — ou limpe os filtros para ver todas as {bookings.length} reservas carregadas.
                </p>
                <button type="button" onClick={clearFilters}
                  className="mt-4 px-4 py-2 text-[11px] uppercase tracking-[0.2em] border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)]/15">
                  Limpar filtros
                </button>
              </>
            )}
          </div>
        ) : filtered.map((b) => (
          <BookingRow key={b.id} b={b} onConfirm={onConfirm} onCancel={onCancel} onReject={onReject} onNoShow={onNoShow} onReschedule={onReschedule} />
        ))}
      </div>
    </div>
  );
}


function AwaitingPixQueue({ bookings, onConfirm, onReject }) {
  if (!bookings?.length) return null;
  return (
    <div data-testid={ADMIN.awaitingQueue} className="glass p-5 mb-6 border border-[var(--brand)]/40">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] flex items-center gap-2">
            <Hourglass className="w-4 h-4" /> Fila PIX — Informados
          </div>
          <p className="text-white/50 text-sm mt-1">
            Comprovante recebido. Confirme ou recuse — nunca confirma sozinho.
          </p>
        </div>
        <div className="font-heading text-3xl text-[var(--brand)]">{bookings.length}</div>
      </div>
      <div className="space-y-2">
        {bookings.slice(0, 12).map((b) => (
          <div key={b.id} className="flex flex-wrap items-center gap-3 p-3 bg-black/30 border border-white/10">
            <div className="min-w-[120px]">
              <div className="text-xs text-white/50">{new Date(b.date + "T00:00:00").toLocaleDateString("pt-BR")}</div>
              <div className="font-heading text-xl text-[var(--brand)]">{b.start_time}</div>
            </div>
            <div className="flex-1 min-w-[140px]">
              <div className="text-sm">{b.customer_name}</div>
              <div className="font-mono text-[11px] text-white/40">+{b.whatsapp}</div>
            </div>
            {b.payment?.comprovante_url ? (
              <a href={`${process.env.REACT_APP_BACKEND_URL}${b.payment.comprovante_url}`}
                target="_blank" rel="noopener noreferrer"
                className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)]/15 flex items-center gap-1">
                <Eye className="w-3 h-3" /> Ver comprovante
              </a>
            ) : (
              <span className="text-[10px] text-white/30 uppercase">Sem link</span>
            )}
            <button onClick={() => onConfirm?.(b.id)}
              className="text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 border border-[var(--success)] text-[var(--success)] hover:bg-[var(--success)]/15 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Confirmar
            </button>
            <button onClick={() => onReject?.(b.id)}
              className="text-[10px] uppercase tracking-[0.2em] px-3 py-1.5 border border-[var(--warning)] text-[var(--warning)] hover:bg-[var(--warning)]/15">
              Recusar
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function BookingRow({ b, onConfirm, onCancel, onReject, onNoShow, onReschedule }) {
  return (
    <motion.div data-testid={ADMIN.bookingRow(b.id)} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      className="min-w-[1100px] grid grid-cols-[160px_220px_1fr_100px_140px_120px_220px] px-4 py-3 items-center border-b border-white/5 hover:bg-white/[0.03] text-sm">
      <div>
        <div>{new Date(b.date+"T00:00:00").toLocaleDateString("pt-BR")}</div>
        <div className="font-heading text-xl text-[var(--brand)]">{b.start_time}</div>
      </div>
      <div>
        <div>{b.customer_name}</div>
        <div className="text-xs text-white/40">{b.court_name}</div>
      </div>
      <div className="font-heading uppercase tracking-wide text-sm">
        <RenderCrest c={b.your_team_crest} /> {b.your_team_name} <span className="text-[var(--brand)]">×</span> {b.opponent_team_name} <RenderCrest c={b.opponent_team_crest} />
      </div>
      <div className="font-mono text-xs">{b.cpf_masked}</div>
      <div className="font-mono text-xs">+{b.whatsapp}</div>
      <div>
        <span className="text-[10px] uppercase tracking-[0.3em] px-2 py-1 border whitespace-nowrap"
          style={{ color: STATUS_COLORS[b.status], borderColor: STATUS_COLORS[b.status] }}>
          {STATUS_LABEL[b.status]}
        </span>
        {b.whatsapp_sent && (
          <div className="text-[9px] mt-1 uppercase tracking-[0.2em] text-[var(--success)] flex items-center gap-1">
            <MessageCircle className="w-2 h-2" /> WA enviado
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {b.payment?.comprovante_url && (
          <a data-testid={ADMIN.viewComprovante(b.id)}
            href={`${process.env.REACT_APP_BACKEND_URL}${b.payment.comprovante_url}`}
            target="_blank" rel="noopener noreferrer"
            className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-[var(--brand)] text-[var(--brand)] hover:bg-[var(--brand)]/15 flex items-center gap-1">
            <Eye className="w-3 h-3" /> Comprovante
          </a>
        )}
        {(b.status === "awaiting_admin" || b.status === "pending") && (
          <button data-testid={ADMIN.confirmBooking(b.id)} onClick={() => onConfirm(b.id)}
            className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-[var(--success)] text-[var(--success)] hover:bg-[var(--success)]/15 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Confirmar
          </button>
        )}
        {b.status === "awaiting_admin" && onReject && (
          <button data-testid={ADMIN.rejectBooking(b.id)} onClick={() => onReject(b.id)}
            className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-[var(--warning)] text-[var(--warning)] hover:bg-[var(--warning)]/15 flex items-center gap-1">
            <FileCheck className="w-3 h-3" /> Recusar PIX
          </button>
        )}
        {b.status !== "cancelled" && b.status !== "expired" && b.status !== "no_show" && onReschedule && (
          <button data-testid={ADMIN.rescheduleBooking(b.id)} onClick={() => onReschedule(b)}
            className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-[var(--brand)]/60 text-[var(--brand)] hover:bg-[var(--brand)]/15 flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Reagendar
          </button>
        )}
        {b.status === "confirmed" && bookingStartIsPast(b) && onNoShow && (
          <button data-testid={ADMIN.noShowBooking(b.id)} onClick={() => onNoShow(b.id)}
            className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-[var(--warning)]/70 text-[var(--warning)] hover:bg-[var(--warning)]/15 flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> No-show
          </button>
        )}
        {b.status !== "cancelled" && b.status !== "expired" && b.status !== "no_show" && b.status !== "awaiting_admin" && (
          <button data-testid={ADMIN.cancelBooking(b.id)} onClick={() => onCancel(b.id)}
            className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-[var(--danger)]/60 text-[var(--danger)] hover:bg-[var(--danger)]/15">
            Cancelar
          </button>
        )}
        {b.status === "awaiting_admin" && (
          <button data-testid={ADMIN.cancelBooking(b.id)} onClick={() => onCancel(b.id)}
            className="text-[10px] uppercase tracking-[0.2em] px-2 py-1 border border-[var(--danger)]/40 text-white/40 hover:text-[var(--danger)] hover:border-[var(--danger)]/60">
            Cancelar
          </button>
        )}
      </div>
    </motion.div>
  );
}

function RenderCrest({ c }) {
  if (typeof c === "string" && c.startsWith("http"))
    return <img src={c} alt="" className="inline w-5 h-5 object-cover align-middle border border-white/15" />;
  return <span>{c}</span>;
}

function TournamentsAdmin({ tournaments, selected, setSelected, onUpdated }) {
  if (!tournaments.length) return <div className="text-white/50">Sem campeonatos.</div>;
  return (
    <div>
      <div className="mb-6">
        <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Campeonato</label>
        <select
          data-testid={ADMIN.tournamentSelect}
          value={selected?.id || ""}
          onChange={(e) => setSelected(tournaments.find(t => t.id === e.target.value))}
          className="mt-1 block bg-black/40 border border-white/15 px-3 py-2 text-white focus:border-[var(--brand)] focus:outline-none w-full md:w-96"
        >
          {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      {selected && (
        <div className="space-y-3">
          {selected.matches.map((m) => (
            <MatchEditor key={m.id} tournamentId={selected.id} m={m} onUpdated={onUpdated} />
          ))}
        </div>
      )}
    </div>
  );
}

function MatchEditor({ tournamentId, m, onUpdated }) {
  const [sa, setSa] = useState(m.score_a);
  const [sb, setSb] = useState(m.score_b);
  const [status, setStatus] = useState(m.status);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await api.post(`/admin/tournaments/${tournamentId}/matches/${m.id}/score`, { score_a: Number(sa), score_b: Number(sb), status });
      onUpdated();
    } finally { setSaving(false); }
  };
  return (
    <div className="glass p-4 grid grid-cols-1 md:grid-cols-[1fr_auto_auto_auto] gap-3 items-center">
      <div className="grid grid-cols-[1fr_auto_60px_auto_60px_auto_1fr] items-center gap-2">
        <div className="text-right font-heading uppercase text-sm">{m.team_a?.crest} {m.team_a?.name || "TBD"}</div>
        <div />
        <input data-testid={`score-a-${m.id}`} type="number" min={0} value={sa} onChange={(e) => setSa(e.target.value)}
          className="bg-black/40 border border-white/15 px-2 py-1 text-center font-heading text-2xl text-[var(--brand)] w-16 focus:border-[var(--brand)] focus:outline-none" />
        <div className="text-white/40">×</div>
        <input data-testid={`score-b-${m.id}`} type="number" min={0} value={sb} onChange={(e) => setSb(e.target.value)}
          className="bg-black/40 border border-white/15 px-2 py-1 text-center font-heading text-2xl text-[var(--brand)] w-16 focus:border-[var(--brand)] focus:outline-none" />
        <div />
        <div className="font-heading uppercase text-sm">{m.team_b?.name || "TBD"} {m.team_b?.crest}</div>
      </div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="bg-black/40 border border-white/15 px-2 py-1 text-sm">
        <option value="scheduled">Agendada</option>
        <option value="live">Ao Vivo</option>
        <option value="finished">Finalizada</option>
      </select>
      <div className="text-xs text-white/40">{new Date(m.scheduled_at).toLocaleDateString("pt-BR")}</div>
      <button data-testid={`save-score-${m.id}`} onClick={save} disabled={saving} className="btn-ghost !py-2 !px-3 !text-xs">
        <Save className="w-3 h-3" /> Salvar
      </button>
    </div>
  );
}


function SiteSettingsAdmin() {
  const { refresh: refreshPublicSettings } = useSiteSettings();
  const [form, setForm] = useState(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/admin/site-settings");
        setForm({
          ...data,
          open_days: Array.isArray(data.open_days) && data.open_days.length
            ? data.open_days.map(Number)
            : [0, 1, 2, 3, 4, 5, 6],
          has_parking: data.has_parking !== false,
          accepts_pix: data.accepts_pix !== false,
          game_duration_note: data.game_duration_note || "",
          structure_blurb: data.structure_blurb || "",
          amenities: Array.isArray(data.amenities) ? data.amenities : [],
          amenities_text: Array.isArray(data.amenities) ? data.amenities.join("\n") : "",
        });
      } catch (e) {
        setErr(e.response?.data?.detail || e.message);
      }
    })();
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setErr(""); setOk("");
    try {
      const amenities = String(form.amenities_text ?? (Array.isArray(form.amenities) ? form.amenities.join("\n") : ""))
        .split(/[\n,]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 12);
      const payload = {
        ...form,
        price_per_hour: Number(form.price_per_hour),
        open_hour: Number(form.open_hour),
        close_hour: Number(form.close_hour),
        open_days: Array.isArray(form.open_days) ? form.open_days.map(Number).sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6],
        slot_duration_minutes: Number(form.slot_duration_minutes),
        cancel_min_hours: Number(form.cancel_min_hours ?? 2),
        reminder_hours_before: Number(form.reminder_hours_before ?? 3),
        admin_whatsapp_e164: String(form.admin_whatsapp_e164 || "").replace(/\D/g, ""),
        admin_alerts_enabled: form.admin_alerts_enabled !== false,
        has_parking: form.has_parking !== false,
        accepts_pix: form.accepts_pix !== false,
        game_duration_note: String(form.game_duration_note || "").trim(),
        structure_blurb: String(form.structure_blurb || "").trim(),
        amenities,
      };
      delete payload.amenities_text;
      const { data } = await api.put("/admin/site-settings", payload);
      setForm({
        ...data,
        amenities_text: Array.isArray(data.amenities) ? data.amenities.join("\n") : "",
      });
      try { await refreshPublicSettings(); } catch (_) { /* public cache best-effort */ }
      setOk("Configurações salvas. Booking, landing e bot usam os novos valores.");
    } catch (e2) {
      const d = e2.response?.data?.detail;
      setErr(typeof d === "string" ? d : (Array.isArray(d) ? d.map(x => x.msg || JSON.stringify(x)).join("; ") : e2.message));
    } finally {
      setBusy(false);
    }
  };

  if (!form) {
    return <div className="glass p-8 text-white/50" data-testid="admin-site-settings">Carregando configurações…</div>;
  }

  const field = (label, key, opts = {}) => (
    <label className="block">
      <div className="text-[10px] uppercase tracking-[0.25em] text-white/55 mb-1">{label}</div>
      {opts.textarea ? (
        <textarea
          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm min-h-[80px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          value={form[key] ?? ""}
          onChange={(e) => set(key, e.target.value)}
          maxLength={opts.maxLength}
        />
      ) : (
        <input
          type={opts.type || "text"}
          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm min-h-[44px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
          value={form[key] ?? ""}
          onChange={(e) => set(key, opts.type === "number" ? e.target.value : e.target.value)}
          min={opts.min}
          max={opts.max}
          step={opts.step}
        />
      )}
    </label>
  );

  return (
    <form onSubmit={save} data-testid="admin-site-settings" className="glass p-6 max-w-3xl space-y-4">
      <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)]">// Site · Quadra única</div>
      <h2 className="font-heading text-4xl uppercase italic mb-2">Configurações</h2>
      <p className="text-white/55 text-sm mb-4">
        WhatsApp, PIX, endereço, estrutura/amenities, preço, horários e dias abertos — booking público, landing e bot WA.
        Cancelamento/remarcação pelo cliente respeita as horas mínimas; lembrete WA usa a antecipação configurada (±30 min). Admin cancela/remarca/no-show sempre.
      </p>
      <div className="grid sm:grid-cols-2 gap-4">
        {field("WhatsApp (E.164 dígitos)", "whatsapp_e164")}
        {field("WhatsApp (exibição)", "whatsapp_display")}
        {field("Chave PIX", "pix_key")}
        {field("Preço / hora (R$)", "price_per_hour", { type: "number", min: 1, step: 1 })}
        {field("Abre (hora 0–23)", "open_hour", { type: "number", min: 0, max: 23 })}
        {field("Fecha — último slot (0–23)", "close_hour", { type: "number", min: 0, max: 23 })}
        {field("Duração do slot (min)", "slot_duration_minutes", { type: "number", min: 30, max: 180, step: 30 })}
        {field("Cancelamento cliente (horas antes)", "cancel_min_hours", { type: "number", min: 0, max: 168, step: 1 })}
        {field("Lembrete WA (horas antes)", "reminder_hours_before", { type: "number", min: 1, max: 48, step: 1 })}
        {field("Nome da quadra", "court_name")}
      </div>
      <div className="border border-white/10 rounded-lg p-4 space-y-3 bg-black/20" data-testid="admin-open-days">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--brand)]">Dias abertos</div>
        <p className="text-white/55 text-xs">
          Marque os dias em que a quadra aceita reservas (0=Seg … 6=Dom, padrão Python/ISO).
          Dias desmarcados ficam indisponíveis no booking e no WhatsApp.
        </p>
        <div className="flex flex-wrap gap-2">
          {OPEN_DAY_LABELS.map((d) => {
            const checked = (form.open_days || []).map(Number).includes(d.value);
            return (
              <label
                key={d.value}
                className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg border cursor-pointer select-none ${
                  checked ? "border-[var(--brand)]/60 bg-[var(--brand)]/10 text-white" : "border-white/10 text-white/50"
                }`}
              >
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-[var(--brand)]"
                  checked={checked}
                  data-testid={`admin-open-day-${d.value}`}
                  onChange={(e) => {
                    const cur = new Set((form.open_days || []).map(Number));
                    if (e.target.checked) cur.add(d.value);
                    else cur.delete(d.value);
                    set("open_days", Array.from(cur).sort((a, b) => a - b));
                  }}
                />
                <span className="text-sm font-display tracking-wide">{d.short}</span>
              </label>
            );
          })}
        </div>
      </div>
      <div className="border border-white/10 rounded-lg p-4 space-y-3 bg-black/20">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--brand)]">Alertas admin (WhatsApp)</div>
        <p className="text-white/55 text-xs">
          Aviso curto quando nasce uma reserva (site ou bot). Só envia se o WhatsApp estiver CONECTADO.
          Deixe o número vazio até configurar o celular do dono — sem placeholders.
        </p>
        {field("WhatsApp admin (E.164, opcional)", "admin_whatsapp_e164")}
        <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
          <input
            type="checkbox"
            className="w-5 h-5 accent-[var(--brand)]"
            checked={form.admin_alerts_enabled !== false}
            onChange={(e) => set("admin_alerts_enabled", e.target.checked)}
            data-testid="admin-alerts-enabled"
          />
          <span className="text-sm text-white/80">Enviar alerta de nova reserva</span>
        </label>
      </div>
      {field("Endereço / local (label)", "address_label")}
      {field("URL Maps", "maps_url")}
      {field("PIX copia-e-cola (texto)", "pix_copy_text", { textarea: true, maxLength: 600 })}
      <div className="border border-white/10 rounded-lg p-4 space-y-3 bg-black/20" data-testid="admin-amenities">
        <div className="text-[10px] uppercase tracking-[0.25em] text-[var(--brand)]">Estrutura · FAQ</div>
        <p className="text-white/55 text-xs">
          Respostas do bot (endereço, estacionamento, duração, PIX) e a faixa “Conheça a quadra” no site.
          Não invente número de rua — use só o label / Maps.
        </p>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-[var(--brand)]"
              checked={form.has_parking !== false}
              onChange={(e) => set("has_parking", e.target.checked)}
              data-testid="admin-has-parking"
            />
            <span className="text-sm text-white/80">Tem estacionamento</span>
          </label>
          <label className="flex items-center gap-3 min-h-[44px] cursor-pointer">
            <input
              type="checkbox"
              className="w-5 h-5 accent-[var(--brand)]"
              checked={form.accepts_pix !== false}
              onChange={(e) => set("accepts_pix", e.target.checked)}
              data-testid="admin-accepts-pix"
            />
            <span className="text-sm text-white/80">Aceita PIX</span>
          </label>
        </div>
        {field("Nota estacionamento", "parking_note", { textarea: true })}
        {field("Duração do jogo (texto FAQ)", "game_duration_note")}
        {field("Texto estrutura / conheça a quadra", "structure_blurb", { textarea: true, maxLength: 400 })}
        <label className="block">
          <div className="text-[10px] uppercase tracking-[0.25em] text-white/55 mb-1">Amenities (um por linha)</div>
          <textarea
            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-sm min-h-[80px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
            value={form.amenities_text ?? ""}
            onChange={(e) => set("amenities_text", e.target.value)}
            data-testid="admin-amenities-text"
            placeholder={"Iluminação noturna\nPelada & treino"}
          />
        </label>
      </div>
      {err && <div className="text-[var(--danger)] text-sm" role="alert">{err}</div>}
      {ok && <div className="text-[var(--success)] text-sm">{ok}</div>}
      <button
        type="submit"
        disabled={busy}
        data-testid="admin-site-settings-save"
        className="btn-neon inline-flex items-center gap-2 min-h-[44px]"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        Salvar
      </button>
    </form>
  );
}

