import React, { useCallback, useEffect, useState } from "react";
import api from "@/lib/api";
import {
  Calendar as CalIcon, ChevronLeft, ChevronRight, Lock, Unlock,
  Plus, X, Loader2, Ban
} from "lucide-react";

const SLOT_STYLE = {
  available: { bg: "bg-white/5", border: "border-white/15", label: "Livre", color: "text-white/70" },
  reserved: { bg: "bg-[var(--brand)]/20", border: "border-[var(--brand)]", label: "Reservado", color: "text-[var(--brand)]" },
  blocked: { bg: "bg-[var(--danger)]/15", border: "border-[var(--danger)]/70", label: "Bloqueado", color: "text-[var(--danger)]" },
  unavailable: { bg: "bg-black/40", border: "border-white/5", label: "Indisponível", color: "text-white/30" },
};

function ymdAdd(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function todayYmd() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

function formatBr(ymd) {
  if (!ymd) return "";
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}`;
}

function weekdayShort(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short" });
}

export default function AdminCalendar() {
  const [mode, setMode] = useState("day"); // day | week
  const [start, setStart] = useState(todayYmd());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [dialog, setDialog] = useState(null); // { type, date, time, slot }

  const daysCount = mode === "day" ? 1 : 7;

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const { data: res } = await api.get(`/admin/calendar?start=${start}&days=${daysCount}`);
      setData(res);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [start, daysCount]);

  useEffect(() => { load(); }, [load]);

  const shift = (dir) => {
    setStart((s) => ymdAdd(s, dir * (mode === "day" ? 1 : 7)));
  };

  const openSlot = (day, slot) => {
    if (slot.status === "unavailable") return;
    setDialog({ type: "actions", date: day.date, time: slot.time, slot });
  };

  const doBlock = async () => {
    if (!window.confirm(`Bloquear ${dialog.date} às ${dialog.time}?`)) return;
    await api.post("/admin/calendar/block", { date: dialog.date, start_time: dialog.time });
    setDialog(null);
    load();
  };

  const doUnblock = async () => {
    if (!window.confirm(`Desbloquear ${dialog.date} às ${dialog.time}?`)) return;
    await api.post("/admin/calendar/unblock", { date: dialog.date, start_time: dialog.time });
    setDialog(null);
    load();
  };

  const doCancelBooking = async () => {
    const id = dialog.slot?.booking_id;
    if (!id) return;
    if (!window.confirm(`Cancelar reserva de ${dialog.slot.customer_name || "cliente"}?`)) return;
    await api.post(`/admin/bookings/${id}/cancel`);
    setDialog(null);
    load();
  };

  const [createForm, setCreateForm] = useState({ customer_name: "", whatsapp: "" });
  const openCreate = () => {
    setCreateForm({ customer_name: "", whatsapp: "" });
    setDialog((d) => ({ ...d, type: "create" }));
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    if (!window.confirm(`Criar reserva ${dialog.date} ${dialog.time} para ${createForm.customer_name}?`)) return;
    try {
      await api.post("/admin/calendar/bookings", {
        date: dialog.date,
        start_time: dialog.time,
        customer_name: createForm.customer_name,
        whatsapp: createForm.whatsapp,
        status: "confirmed",
      });
      setDialog(null);
      load();
    } catch (ex) {
      alert(ex.response?.data?.detail || ex.message);
    }
  };

  const days = data?.days || [];

  return (
    <div data-testid="admin-calendar" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] flex items-center gap-2">
            <CalIcon className="w-4 h-4" /> Agenda · 1 quadra
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl uppercase italic">Calendário</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-white/15 overflow-hidden">
            <button type="button" onClick={() => setMode("day")}
              className={`px-3 py-2 text-[11px] uppercase tracking-[0.2em] ${mode === "day" ? "bg-[var(--brand)]/20 text-[var(--brand)]" : "text-white/50"}`}>
              Dia
            </button>
            <button type="button" onClick={() => { setMode("week"); }}
              className={`px-3 py-2 text-[11px] uppercase tracking-[0.2em] ${mode === "week" ? "bg-[var(--brand)]/20 text-[var(--brand)]" : "text-white/50"}`}>
              Semana
            </button>
          </div>
          <button type="button" onClick={() => shift(-1)} className="btn-ghost !py-2 !px-3" aria-label="Anterior">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setStart(todayYmd())} className="btn-ghost !py-2 !px-3 !text-xs">
            Hoje
          </button>
          <button type="button" onClick={() => shift(1)} className="btn-ghost !py-2 !px-3" aria-label="Próximo">
            <ChevronRight className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="bg-black/40 border border-white/15 px-2 py-2 text-sm text-white"
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.2em] text-white/50">
        {Object.entries(SLOT_STYLE).map(([k, v]) => (
          <span key={k} className={`px-2 py-1 border ${v.border} ${v.color}`}>{v.label}</span>
        ))}
      </div>

      {err && <div className="text-[var(--danger)] text-sm">{err}</div>}
      {loading && !data && (
        <div className="flex justify-center py-16 text-white/50">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--brand)]" />
        </div>
      )}

      {days.length > 0 && (
        <div className={`grid gap-3 ${mode === "week" ? "grid-cols-1 md:grid-cols-7 overflow-x-auto" : "grid-cols-1"}`}>
          {days.map((day) => (
            <div key={day.date} className="glass p-3 min-w-0">
              <div className="sticky top-0 bg-transparent pb-2 mb-2 border-b border-white/10">
                <div className="text-[10px] uppercase tracking-[0.25em] text-white/40">{weekdayShort(day.date)}</div>
                <div className="font-heading text-2xl text-[var(--brand)]">{formatBr(day.date)}</div>
              </div>
              <div className={`grid gap-1.5 ${mode === "day" ? "grid-cols-2 sm:grid-cols-4 md:grid-cols-6" : "grid-cols-1"}`}>
                {day.slots.map((slot) => {
                  const st = SLOT_STYLE[slot.status] || SLOT_STYLE.unavailable;
                  return (
                    <button
                      key={slot.time}
                      type="button"
                      disabled={slot.status === "unavailable"}
                      onClick={() => openSlot(day, slot)}
                      className={`text-left px-2 py-2 border ${st.bg} ${st.border} ${st.color} disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition min-h-[52px]`}
                    >
                      <div className="font-heading text-lg leading-none">{slot.time}</div>
                      <div className="text-[9px] uppercase tracking-[0.15em] mt-1 truncate">
                        {slot.status === "reserved"
                          ? (slot.customer_name || "Reservado")
                          : st.label}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-md grid place-items-center p-4" onClick={() => setDialog(null)}>
          <div onClick={(e) => e.stopPropagation()} className="glass-strong w-[min(420px,95vw)] p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)]">Slot</div>
                <h3 className="font-heading text-3xl uppercase italic">
                  {formatBr(dialog.date)} · {dialog.time}
                </h3>
                <p className="text-white/50 text-sm mt-1">
                  Status: {SLOT_STYLE[dialog.slot?.status]?.label || dialog.slot?.status}
                  {dialog.slot?.customer_name ? ` · ${dialog.slot.customer_name}` : ""}
                </p>
              </div>
              <button type="button" onClick={() => setDialog(null)} className="text-white/50 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            {dialog.type === "actions" && (
              <div className="mt-6 flex flex-col gap-2">
                {dialog.slot.status === "available" && (
                  <>
                    <button type="button" onClick={openCreate} className="btn-neon justify-center !text-sm">
                      <Plus className="w-4 h-4" /> Criar reserva
                    </button>
                    <button type="button" onClick={doBlock} className="btn-ghost justify-center !text-sm">
                      <Lock className="w-4 h-4" /> Bloquear horário
                    </button>
                  </>
                )}
                {dialog.slot.status === "blocked" && (
                  <button type="button" onClick={doUnblock} className="btn-neon justify-center !text-sm">
                    <Unlock className="w-4 h-4" /> Desbloquear
                  </button>
                )}
                {dialog.slot.status === "reserved" && (
                  <button type="button" onClick={doCancelBooking} className="btn-ghost justify-center !text-sm text-[var(--danger)] border-[var(--danger)]/50">
                    <Ban className="w-4 h-4" /> Cancelar reserva
                  </button>
                )}
                <button type="button" onClick={() => setDialog(null)} className="btn-ghost justify-center !text-sm mt-2">
                  Fechar
                </button>
              </div>
            )}

            {dialog.type === "create" && (
              <form onSubmit={submitCreate} className="mt-6 space-y-3">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Nome</label>
                  <input required minLength={2} value={createForm.customer_name}
                    onChange={(e) => setCreateForm({ ...createForm, customer_name: e.target.value })}
                    className="mt-1 w-full bg-black/40 border border-white/15 px-3 py-2 text-white focus:border-[var(--brand)] focus:outline-none" />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">WhatsApp</label>
                  <input required minLength={8} value={createForm.whatsapp}
                    onChange={(e) => setCreateForm({ ...createForm, whatsapp: e.target.value })}
                    placeholder="11999999999"
                    className="mt-1 w-full bg-black/40 border border-white/15 px-3 py-2 text-white focus:border-[var(--brand)] focus:outline-none" />
                </div>
                <div className="flex gap-2 pt-2">
                  <button type="submit" className="btn-neon flex-1 justify-center !text-sm">Confirmar criação</button>
                  <button type="button" onClick={() => setDialog((d) => ({ ...d, type: "actions" }))} className="btn-ghost !text-sm">Voltar</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
