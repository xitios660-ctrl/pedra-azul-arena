import React, { useCallback, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import {
  Calendar as CalIcon, ChevronLeft, ChevronRight, Lock, Unlock,
  Plus, X, Ban, UserCheck
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

function todayYmdSaoPaulo() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return todayYmd();
  }
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

function monthStart(ymd) {
  const [y, m] = ymd.split("-").map(Number);
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

function daysInMonth(ymd) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function monthLabel(ymd) {
  const [y, m] = ymd.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

/** Density heat: occupied (brand) vs blocked (danger) vs free (muted) */
function densityStyle(density) {
  if (!density) return { bg: "bg-white/5", border: "border-white/10" };
  const bookable = density.total_bookable || 0;
  const occ = density.occupied || 0;
  const blk = density.blocked || 0;
  if (bookable <= 0) return { bg: "bg-black/30", border: "border-white/5" };
  const filled = occ + blk;
  const ratio = filled / bookable;
  if (ratio >= 0.75) return { bg: "bg-[var(--brand)]/35", border: "border-[var(--brand)]" };
  if (ratio >= 0.4) return { bg: "bg-[var(--brand)]/18", border: "border-[var(--brand)]/50" };
  if (blk > 0 && occ === 0) return { bg: "bg-[var(--danger)]/15", border: "border-[var(--danger)]/40" };
  if (filled > 0) return { bg: "bg-[var(--brand)]/10", border: "border-white/20" };
  return { bg: "bg-white/5", border: "border-white/15" };
}

export default function AdminCalendar() {
  const [mode, setMode] = useState("day"); // day | week | month
  const [start, setStart] = useState(todayYmd());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [dialog, setDialog] = useState(null); // { type, date, time, slot }

  const daysCount = useMemo(() => {
    if (mode === "day") return 1;
    if (mode === "week") return 7;
    return daysInMonth(start);
  }, [mode, start]);

  const loadStart = useMemo(() => {
    if (mode === "month") return monthStart(start);
    return start;
  }, [mode, start]);

  const load = useCallback(async () => {
    setLoading(true); setErr("");
    try {
      const { data: res } = await api.get(`/admin/calendar?start=${loadStart}&days=${daysCount}`);
      setData(res);
    } catch (e) {
      setErr(e.response?.data?.detail || e.message);
    } finally {
      setLoading(false);
    }
  }, [loadStart, daysCount]);

  useEffect(() => { load(); }, [load]);

  const shift = (dir) => {
    if (mode === "day") setStart((s) => ymdAdd(s, dir));
    else if (mode === "week") setStart((s) => ymdAdd(s, dir * 7));
    else {
      // month: move by calendar month
      const [y, m] = start.split("-").map(Number);
      const dt = new Date(y, m - 1 + dir, 1);
      const yy = dt.getFullYear();
      const mm = String(dt.getMonth() + 1).padStart(2, "0");
      setStart(`${yy}-${mm}-01`);
    }
  };

  const openSlot = (day, slot) => {
    if (slot.status === "unavailable") return;
    setDialog({ type: "actions", date: day.date, time: slot.time, slot });
  };

  const openDayFromMonth = (ymd) => {
    setStart(ymd);
    setMode("day");
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

  const doCheckIn = async () => {
    const id = dialog.slot?.booking_id;
    if (!id) return;
    try {
      await api.post(`/admin/bookings/${id}/check-in`);
      setDialog(null);
      load();
    } catch (ex) {
      alert(ex.response?.data?.detail || ex.message);
    }
  };

  const doUndoCheckIn = async () => {
    const id = dialog.slot?.booking_id;
    if (!id) return;
    try {
      await api.post(`/admin/bookings/${id}/check-in/undo`);
      setDialog(null);
      load();
    } catch (ex) {
      alert(ex.response?.data?.detail || ex.message);
    }
  };

  const [createForm, setCreateForm] = useState({ customer_name: "", whatsapp: "", duration_hours: 1, weeks: 1 });
  const [rangeForm, setRangeForm] = useState({
    date_from: todayYmd(),
    date_to: todayYmd(),
    reason: "",
  });
  const [dayBusy, setDayBusy] = useState(false);
  const [toast, setToast] = useState("");

  const focusDate = mode === "month" ? loadStart : start;

  const doBlockDay = async (ymd) => {
    if (!ymd) return;
    const reason = window.prompt(`Motivo do bloqueio de ${ymd} (opcional — ex: manutenção, feriado):`, "") ?? null;
    if (reason === null) return;
    if (!window.confirm(`Bloquear o dia inteiro ${ymd}?\nReservas existentes NÃO serão canceladas.`)) return;
    setDayBusy(true); setToast("");
    try {
      const { data: res } = await api.post("/admin/calendar/block-day", {
        date: ymd,
        reason: reason.trim() || undefined,
      });
      setToast(`Dia ${ymd}: ${res.blocked || 0} bloqueados · ${res.skipped_reserved || 0} com reserva`);
      load();
    } catch (ex) {
      alert(ex.response?.data?.detail || ex.message);
    } finally {
      setDayBusy(false);
    }
  };

  const doUnblockDay = async (ymd) => {
    if (!ymd) return;
    if (!window.confirm(`Desbloquear todos os horários bloqueados de ${ymd}?\nReservas não são alteradas.`)) return;
    setDayBusy(true); setToast("");
    try {
      const { data: res } = await api.post("/admin/calendar/unblock-day", { date: ymd });
      setToast(`Dia ${ymd}: ${res.removed || 0} bloqueios removidos`);
      load();
    } catch (ex) {
      alert(ex.response?.data?.detail || ex.message);
    } finally {
      setDayBusy(false);
    }
  };

  const submitRangeBlock = async (e) => {
    e.preventDefault();
    const { date_from, date_to, reason } = rangeForm;
    if (!date_from || !date_to) return;
    if (!window.confirm(
      `Bloquear de ${date_from} até ${date_to} (inclusive)?\nMáx. 31 dias. Reservas existentes não serão canceladas.`
    )) return;
    setDayBusy(true); setToast("");
    try {
      const { data: res } = await api.post("/admin/calendar/block-range", {
        date_from,
        date_to,
        reason: (reason || "").trim() || undefined,
      });
      setToast(
        `Período: ${res.blocked || 0} bloqueados · ${res.skipped_reserved || 0} com reserva · ${res.days || 0} dias`
      );
      load();
    } catch (ex) {
      alert(ex.response?.data?.detail || ex.message);
    } finally {
      setDayBusy(false);
    }
  };

  const openCreate = () => {
    setCreateForm({ customer_name: "", whatsapp: "", duration_hours: 1, weeks: 1 });
    setDialog((d) => ({ ...d, type: "create" }));
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    const weeks = Math.max(1, Number(createForm.weeks) || 1);
    const label = weeks > 1
      ? `Criar série de ${weeks} semanas (${dialog.date} ${dialog.time}) para ${createForm.customer_name}?`
      : `Criar reserva ${dialog.date} ${dialog.time} para ${createForm.customer_name}?`;
    if (!window.confirm(label)) return;
    try {
      if (weeks >= 2) {
        const { data } = await api.post("/admin/calendar/bookings/recurring", {
          date: dialog.date,
          start_time: dialog.time,
          customer_name: createForm.customer_name,
          whatsapp: createForm.whatsapp,
          status: "confirmed",
          duration_hours: Number(createForm.duration_hours) || 1,
          weeks,
        });
        alert(data.summary || `${data.created_count} criadas`);
      } else {
        await api.post("/admin/calendar/bookings", {
          date: dialog.date,
          start_time: dialog.time,
          customer_name: createForm.customer_name,
          whatsapp: createForm.whatsapp,
          status: "confirmed",
          duration_hours: Number(createForm.duration_hours) || 1,
        });
      }
      setDialog(null);
      load();
    } catch (ex) {
      const d = ex.response?.data?.detail;
      alert((d && typeof d === "object" && d.message) ? d.message : (d || ex.message));
    }
  };

  const days = useMemo(() => data?.days || [], [data?.days]);

  // Pad month grid to weeks starting Monday (pt-BR)
  const monthCells = useMemo(() => {
    if (mode !== "month" || !days.length) return [];
    const first = days[0]?.date;
    if (!first) return [];
    const [y, m, d] = first.split("-").map(Number);
    const sundayIdx = new Date(y, m - 1, d).getDay(); // 0=Sun
    const mondayIdx = (sundayIdx + 6) % 7; // Mon=0 … Sun=6
    const cells = [];
    for (let i = 0; i < mondayIdx; i++) cells.push(null);
    days.forEach((day) => cells.push(day));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [mode, days]);

  return (
    <div data-testid="admin-calendar" className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.35em] text-[var(--brand)] flex items-center gap-2">
            <CalIcon className="w-4 h-4" /> Agenda · 1 quadra
          </div>
          <h2 className="font-heading text-3xl sm:text-4xl uppercase italic">Calendário</h2>
          {mode === "month" && (
            <p className="text-white/50 text-sm mt-1 capitalize">{monthLabel(loadStart)}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex border border-white/15 overflow-hidden">
            {[
              { id: "day", label: "Dia" },
              { id: "week", label: "Semana" },
              { id: "month", label: "Mês" },
            ].map((m) => (
              <button
                key={m.id}
                type="button"
                data-testid={`admin-calendar-mode-${m.id}`}
                onClick={() => {
                  if (m.id === "month") setStart(monthStart(start));
                  setMode(m.id);
                }}
                className={`px-3 py-2 text-[11px] uppercase tracking-[0.2em] ${
                  mode === m.id ? "bg-[var(--brand)]/20 text-[var(--brand)]" : "text-white/50"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => shift(-1)} className="btn-ghost !py-2 !px-3" aria-label="Anterior">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const t = todayYmd();
              setStart(mode === "month" ? monthStart(t) : t);
            }}
            className="btn-ghost !py-2 !px-3 !text-xs"
          >
            Hoje
          </button>
          <button type="button" onClick={() => shift(1)} className="btn-ghost !py-2 !px-3" aria-label="Próximo">
            <ChevronRight className="w-4 h-4" />
          </button>
          {mode !== "month" && (
            <input
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="bg-black/40 border border-white/15 px-2 py-2 text-sm text-white"
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[10px] uppercase tracking-[0.2em] text-white/50">
        {mode === "month" ? (
          <>
            <span className="px-2 py-1 border border-white/15 text-white/70">Livre</span>
            <span className="px-2 py-1 border border-[var(--brand)]/50 text-[var(--brand)]">Ocupado (densidade)</span>
            <span className="px-2 py-1 border border-[var(--danger)]/40 text-[var(--danger)]">Bloqueado</span>
          </>
        ) : (
          Object.entries(SLOT_STYLE).map(([k, v]) => (
            <span key={k} className={`px-2 py-1 border ${v.border} ${v.color}`}>{v.label}</span>
          ))
        )}
      </div>

      <div data-testid="admin-calendar-block-toolbar" className="glass p-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 mr-1">Dia focado</span>
          <span className="text-sm text-[var(--brand)] font-heading">{focusDate}</span>
          <button
            type="button"
            data-testid="admin-calendar-block-day"
            disabled={dayBusy || mode === "month"}
            onClick={() => doBlockDay(start)}
            className="btn-ghost !py-2 !px-3 !text-xs inline-flex items-center gap-1 disabled:opacity-40"
            title={mode === "month" ? "Abra a visão Dia para bloquear" : "Bloquear dia inteiro"}
          >
            <Lock className="w-3.5 h-3.5" /> Bloquear dia
          </button>
          <button
            type="button"
            data-testid="admin-calendar-unblock-day"
            disabled={dayBusy || mode === "month"}
            onClick={() => doUnblockDay(start)}
            className="btn-ghost !py-2 !px-3 !text-xs inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Unlock className="w-3.5 h-3.5" /> Desbloquear dia
          </button>
        </div>
        <form onSubmit={submitRangeBlock} className="flex flex-wrap items-end gap-2 border-t border-white/10 pt-3">
          <div>
            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40 block mb-1">De</label>
            <input
              type="date"
              required
              value={rangeForm.date_from}
              onChange={(e) => setRangeForm((f) => ({ ...f, date_from: e.target.value }))}
              className="bg-black/40 border border-white/15 px-2 py-2 text-sm text-white"
              data-testid="admin-calendar-range-from"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40 block mb-1">Até</label>
            <input
              type="date"
              required
              value={rangeForm.date_to}
              onChange={(e) => setRangeForm((f) => ({ ...f, date_to: e.target.value }))}
              className="bg-black/40 border border-white/15 px-2 py-2 text-sm text-white"
              data-testid="admin-calendar-range-to"
            />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40 block mb-1">Motivo</label>
            <input
              type="text"
              maxLength={200}
              placeholder="manutenção / feriado…"
              value={rangeForm.reason}
              onChange={(e) => setRangeForm((f) => ({ ...f, reason: e.target.value }))}
              className="w-full bg-black/40 border border-white/15 px-2 py-2 text-sm text-white focus:border-[var(--brand)] focus:outline-none"
              data-testid="admin-calendar-range-reason"
            />
          </div>
          <button
            type="submit"
            disabled={dayBusy}
            data-testid="admin-calendar-block-range"
            className="btn-neon !py-2 !px-3 !text-xs inline-flex items-center gap-1 disabled:opacity-40"
          >
            <Lock className="w-3.5 h-3.5" /> Bloquear período
          </button>
        </form>
        {toast && (
          <p className="text-xs text-[var(--brand)]" data-testid="admin-calendar-block-toast">{toast}</p>
        )}
      </div>

      {err && <div className="text-[var(--danger)] text-sm">{err}</div>}
      {loading && !data && (
        <div className="grid gap-3 grid-cols-1 md:grid-cols-7" aria-busy="true" aria-label="Carregando calendário">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="skeleton-card h-[280px]" />
          ))}
        </div>
      )}

      {mode === "month" && monthCells.length > 0 && (
        <div data-testid="admin-calendar-month" className="glass p-3">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map((w) => (
              <div key={w} className="text-center text-[10px] uppercase tracking-[0.2em] text-white/40 py-1">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {monthCells.map((day, idx) => {
              if (!day) {
                return <div key={`pad-${idx}`} className="min-h-[72px] bg-black/20 border border-transparent" />;
              }
              const dens = day.density || {};
              const st = densityStyle(dens);
              const isToday = day.date === todayYmd();
              return (
                <div
                  key={day.date}
                  data-testid={`admin-calendar-day-${day.date}`}
                  className={`min-h-[72px] sm:min-h-[88px] text-left p-2 border transition ${st.bg} ${st.border} ${
                    isToday ? "ring-1 ring-[var(--brand)]" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => openDayFromMonth(day.date)}
                    className="w-full text-left hover:brightness-110"
                  >
                    <div className="font-heading text-lg text-[var(--brand)]">{formatBr(day.date).split("/")[0]}</div>
                    <div className="mt-1 text-[9px] uppercase tracking-[0.12em] text-white/55 leading-tight">
                      <span className="text-[var(--brand)]">{dens.occupied || 0} oc</span>
                      {" · "}
                      <span className="text-[var(--danger)]">{dens.blocked || 0} bl</span>
                      {" · "}
                      <span>{dens.free || 0} lv</span>
                    </div>
                  </button>
                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      title="Bloquear dia"
                      aria-label={`Bloquear dia ${day.date}`}
                      disabled={dayBusy}
                      onClick={(e) => { e.stopPropagation(); doBlockDay(day.date); }}
                      className="text-[9px] uppercase tracking-wider px-1 py-0.5 border border-[var(--danger)]/40 text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-40"
                    >
                      Blq
                    </button>
                    <button
                      type="button"
                      title="Desbloquear dia"
                      aria-label={`Desbloquear dia ${day.date}`}
                      disabled={dayBusy}
                      onClick={(e) => { e.stopPropagation(); doUnblockDay(day.date); }}
                      className="text-[9px] uppercase tracking-wider px-1 py-0.5 border border-white/20 text-white/50 hover:bg-white/5 disabled:opacity-40"
                    >
                      Lib
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[10px] text-white/40 mt-3 uppercase tracking-[0.2em]">
            Clique no dia para ver horários · Blq/Lib = bloquear/desbloquear dia · oc=ocupado · bl=bloqueado · lv=livre
          </p>
        </div>
      )}

      {mode !== "month" && days.length > 0 && (
        <div className={`grid gap-3 ${mode === "week" ? "grid-cols-1 md:grid-cols-7 overflow-x-auto" : "grid-cols-1"}`}>
          {days.map((day) => (
            <div key={day.date} className="glass p-3 min-w-0">
              <div className="sticky top-0 bg-transparent pb-2 mb-2 border-b border-white/10 flex items-start justify-between gap-2">
                <div>
                  <div className="text-[10px] uppercase tracking-[0.25em] text-white/40">{weekdayShort(day.date)}</div>
                  <div className="font-heading text-2xl text-[var(--brand)]">{formatBr(day.date)}</div>
                </div>
                {mode === "day" && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      data-testid="admin-calendar-day-block-btn"
                      disabled={dayBusy}
                      onClick={() => doBlockDay(day.date)}
                      className="btn-ghost !py-1 !px-2 !text-[10px] inline-flex items-center gap-1"
                    >
                      <Lock className="w-3 h-3" /> Bloquear dia
                    </button>
                    <button
                      type="button"
                      data-testid="admin-calendar-day-unblock-btn"
                      disabled={dayBusy}
                      onClick={() => doUnblockDay(day.date)}
                      className="btn-ghost !py-1 !px-2 !text-[10px] inline-flex items-center gap-1"
                    >
                      <Unlock className="w-3 h-3" /> Desbloquear dia
                    </button>
                  </div>
                )}
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
                      <div className="font-heading text-lg leading-none flex items-center gap-1">
                        {slot.time}
                        {slot.checked_in && <UserCheck className="w-3 h-3 text-[var(--success)]" aria-label="Chegou" />}
                      </div>
                      <div className="text-[9px] uppercase tracking-[0.15em] mt-1 truncate">
                        {slot.status === "reserved"
                          ? (
                              (slot.checked_in ? "Chegou · " : "")
                              + (slot.is_continuation ? "↳ " : "")
                              + (slot.customer_name || "Reservado")
                              + (slot.duration_minutes > 60 && !slot.is_continuation
                                  ? ` · ${Math.round(slot.duration_minutes / 60)}h`
                                  : "")
                            )
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
                  {dialog.slot?.duration_minutes > 60
                    ? ` · ${Math.round(dialog.slot.duration_minutes / 60)}h`
                    : ""}
                  {dialog.slot?.is_continuation ? " · continuação" : ""}
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
                  <>
                    {dialog.date === todayYmdSaoPaulo()
                      && (dialog.slot.booking_status === "confirmed" || dialog.slot.checked_in)
                      && (
                      dialog.slot.checked_in ? (
                        <button type="button" onClick={doUndoCheckIn} className="btn-ghost justify-center !text-sm">
                          <UserCheck className="w-4 h-4" /> Desfazer chegou
                        </button>
                      ) : (
                        <button type="button" data-testid="admin-calendar-checkin" onClick={doCheckIn} className="btn-neon justify-center !text-sm">
                          <UserCheck className="w-4 h-4" /> Chegou
                        </button>
                      )
                    )}
                    <button type="button" onClick={doCancelBooking} className="btn-ghost justify-center !text-sm text-[var(--danger)] border-[var(--danger)]/50">
                      <Ban className="w-4 h-4" /> Cancelar reserva
                    </button>
                    {dialog.slot?.series_id && (
                      <button
                        type="button"
                        data-testid="admin-calendar-cancel-series"
                        onClick={async () => {
                          if (!window.confirm("Cancelar toda a série futura desta reserva?")) return;
                          try {
                            const { data } = await api.post(`/admin/bookings/series/${dialog.slot.series_id}/cancel-future`);
                            alert(`${data.cancelled_count || 0} reserva(s) cancelada(s).`);
                            setDialog(null);
                            load();
                          } catch (ex) {
                            alert(ex.response?.data?.detail || ex.message);
                          }
                        }}
                        className="btn-ghost justify-center !text-sm text-[var(--danger)] border-[var(--danger)]/50"
                      >
                        <Ban className="w-4 h-4" /> Cancelar série futura
                      </button>
                    )}
                  </>
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
                <div>
                  <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Duração</label>
                  <div className="mt-2 flex gap-2">
                    {[1, 2].map((h) => {
                      const maxC = dialog.slot?.max_consecutive || 1;
                      const enabled = h <= maxC;
                      return (
                        <button
                          key={h}
                          type="button"
                          disabled={!enabled}
                          onClick={() => enabled && setCreateForm({ ...createForm, duration_hours: h })}
                          className={`px-3 py-2 text-xs border uppercase tracking-wider ${
                            createForm.duration_hours === h
                              ? "border-[var(--brand)] text-[var(--brand)]"
                              : enabled
                                ? "border-white/20 text-white/70"
                                : "border-white/10 text-white/30"
                          }`}
                        >
                          {h}h
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div data-testid="admin-calendar-recurring">
                  <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Repetir semanas</label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[1, 2, 3, 4, 8].map((w) => (
                      <button
                        key={w}
                        type="button"
                        data-testid={`admin-calendar-weeks-${w}`}
                        onClick={() => setCreateForm({ ...createForm, weeks: w })}
                        className={`px-3 py-2 text-xs border uppercase tracking-wider ${
                          Number(createForm.weeks) === w
                            ? "border-[var(--brand)] text-[var(--brand)]"
                            : "border-white/20 text-white/70"
                        }`}
                      >
                        {w === 1 ? "1×" : `${w} sem.`}
                      </button>
                    ))}
                  </div>
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
