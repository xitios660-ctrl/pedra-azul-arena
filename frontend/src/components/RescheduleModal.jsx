import React, { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { onlyDigits } from "@/lib/cpf";
import { Loader2 } from "lucide-react";

/**
 * mode: "customer" | "admin"
 * customer needs cpf; admin uses Bearer session.
 */
export default function RescheduleModal({ booking, cpf, mode = "customer", onClose, onDone }) {
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [picked, setPicked] = useState("");

  useEffect(() => {
    if (!date) { setSlots([]); return; }
    let cancelled = false;
    setLoading(true); setErr(""); setPicked("");
    api.get("/courts/availability", { params: { court_id: booking.court_id || "court-1", date } })
      .then(({ data }) => {
        if (cancelled) return;
        setSlots((data.slots || []).filter((s) => s.status === "available"));
      })
      .catch((e) => {
        if (!cancelled) setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [date, booking.court_id]);

  const confirm = async () => {
    if (!date || !picked) return;
    if (!window.confirm(`Remarcar para ${new Date(date + "T00:00:00").toLocaleDateString("pt-BR")} às ${picked}?`)) return;
    setSaving(true); setErr("");
    try {
      if (mode === "admin") {
        await api.post(`/admin/bookings/${booking.id}/reschedule`, { date, start_time: picked });
      } else {
        await api.post(`/bookings/${booking.id}/reschedule`, {
          cpf: onlyDigits(cpf),
          date,
          start_time: picked,
        });
      }
      onDone();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 backdrop-blur-md grid place-items-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="glass-strong w-[min(480px,95vw)] p-6">
        <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)]">Reagendar</div>
        <h3 className="font-heading text-2xl uppercase italic mt-1">Novo horário</h3>
        <p className="text-sm text-white/55 mt-2">
          Atual: {new Date(booking.date + "T00:00:00").toLocaleDateString("pt-BR")} às {booking.start_time}.
          {" "}Pagamento/status são mantidos.
        </p>
        <label className="block mt-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">Data</div>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full bg-black/40 border border-white/15 px-3 py-2 text-white focus:border-[var(--brand)] focus:outline-none"
          />
        </label>
        <div className="mt-4">
          <div className="text-[10px] tracking-[0.3em] uppercase text-white/40 mb-2">Horários livres</div>
          {loading && <div className="text-sm text-white/50 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Carregando…</div>}
          {!loading && date && slots.length === 0 && (
            <div className="text-sm text-white/50">Nenhum horário livre nesta data.</div>
          )}
          <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
            {slots.map((s) => (
              <button
                key={s.time}
                type="button"
                onClick={() => setPicked(s.time)}
                className={`text-xs px-3 py-1.5 border ${
                  picked === s.time
                    ? "border-[var(--brand)] text-[var(--brand)] bg-[var(--brand)]/15"
                    : "border-white/20 text-white/70 hover:border-white/40"
                }`}
              >
                {s.time}
              </button>
            ))}
          </div>
        </div>
        {err && <div className="mt-3 text-xs text-[var(--danger)]">{err}</div>}
        <div className="mt-5 flex gap-2">
          <button type="button" disabled={!picked || saving} onClick={confirm} className="btn-neon flex-1 justify-center !py-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Confirmar remarcação"}
          </button>
          <button type="button" onClick={onClose} className="btn-ghost !py-2">Fechar</button>
        </div>
      </div>
    </div>
  );
}
