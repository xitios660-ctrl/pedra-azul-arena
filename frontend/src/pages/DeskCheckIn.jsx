import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_BASE, formatApiErrorDetail } from "@/lib/api";
import { LogOut, Check, RotateCcw, KeyRound } from "lucide-react";

const DESK_TOKEN_KEY = "desk_token";

const deskApi = axios.create({
  baseURL: API_BASE,
  withCredentials: false,
});

deskApi.interceptors.request.use((config) => {
  const token = localStorage.getItem(DESK_TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function formatTime(t) {
  if (!t) return "—";
  return String(t).slice(0, 5);
}

export default function DeskCheckIn() {
  const [token, setToken] = useState(() => localStorage.getItem(DESK_TOKEN_KEY) || "");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bookings, setBookings] = useState([]);
  const [dateLabel, setDateLabel] = useState("");
  const [actionId, setActionId] = useState("");

  const loggedIn = Boolean(token);

  const logout = useCallback(() => {
    localStorage.removeItem(DESK_TOKEN_KEY);
    setToken("");
    setPin("");
    setBookings([]);
    setErr("");
  }, []);

  const loadToday = useCallback(async () => {
    setErr("");
    try {
      const { data } = await deskApi.get("/desk/today");
      setBookings(data.bookings || []);
      setDateLabel(data.date || "");
    } catch (e) {
      const status = e.response?.status;
      if (status === 401 || status === 403) {
        logout();
        setErr("Sessão expirada. Digite o PIN novamente.");
        return;
      }
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    }
  }, [logout]);

  useEffect(() => {
    if (loggedIn) loadToday();
  }, [loggedIn, loadToday]);

  const submitPin = async (rawPin) => {
    const digits = String(rawPin || "").replace(/\D/g, "");
    if (digits.length < 4) {
      setErr("PIN deve ter 4 a 8 dígitos");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const { data } = await axios.post(
        `${API_BASE}/desk/session`,
        { pin: digits },
        { headers: { "Content-Type": "application/json" } },
      );
      const t = data.access_token;
      if (!t) throw new Error("Token não retornado");
      localStorage.setItem(DESK_TOKEN_KEY, t);
      setToken(t);
      setPin("");
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message || "PIN inválido");
      setPin("");
    } finally {
      setBusy(false);
    }
  };

  const onDigit = (d) => {
    if (busy) return;
    setErr("");
    setPin((p) => {
      const next = (p + d).slice(0, 8);
      if (next.length >= 4 && next.length === 8) {
        // auto-submit at 8; user can also tap Entrar earlier
      }
      return next;
    });
  };

  const onBackspace = () => {
    if (busy) return;
    setPin((p) => p.slice(0, -1));
  };

  const markChegou = async (id) => {
    setActionId(id);
    setErr("");
    try {
      await deskApi.post(`/desk/bookings/${id}/check-in`);
      await loadToday();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setActionId("");
    }
  };

  const undoChegou = async (id) => {
    setActionId(id);
    setErr("");
    try {
      await deskApi.post(`/desk/bookings/${id}/check-in/undo`);
      await loadToday();
    } catch (e) {
      setErr(formatApiErrorDetail(e.response?.data?.detail) || e.message);
    } finally {
      setActionId("");
    }
  };

  const pad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "OK"];

  return (
    <div
      className="min-h-screen bg-[var(--bg-base,#030305)] text-white px-4 py-6 pb-10"
      data-testid="desk-checkin-page"
    >
      <div className="max-w-md mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand,#00E5FF)]">
              // Balcão
            </div>
            <h1 className="font-heading text-4xl uppercase italic leading-none mt-1">
              Check-<span className="text-[var(--brand,#00E5FF)]">in</span>
            </h1>
          </div>
          {loggedIn && (
            <button
              type="button"
              data-testid="desk-logout"
              onClick={logout}
              className="btn-ghost inline-flex items-center gap-2 min-h-[44px] px-3"
            >
              <LogOut className="w-4 h-4" /> Sair
            </button>
          )}
        </div>

        {!loggedIn ? (
          <div className="glass-strong p-6 space-y-5" data-testid="desk-pin-pad">
            <div className="flex items-center gap-2 text-white/60 text-sm">
              <KeyRound className="w-4 h-4 text-[var(--brand,#00E5FF)]" />
              Digite o PIN do balcão
            </div>
            <div className="flex justify-center gap-2 min-h-[28px]" aria-label="PIN">
              {(pin.length ? Array.from(pin) : ["", "", "", ""]).slice(0, 8).map((_, i) => (
                <span
                  key={i}
                  className={`w-3 h-3 rounded-full border ${
                    i < pin.length
                      ? "bg-[var(--brand,#00E5FF)] border-[var(--brand,#00E5FF)] shadow-[0_0_10px_var(--brand-glow,rgba(0,229,255,0.45))]"
                      : "border-white/30"
                  }`}
                />
              ))}
            </div>
            {err && (
              <div
                data-testid="desk-pin-error"
                className="px-3 py-2 text-sm border-l-2 border-[var(--danger)] bg-[var(--danger)]/10"
                role="alert"
              >
                {err}
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              {pad.map((key) => {
                const isOk = key === "OK";
                const isBk = key === "⌫";
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={busy || (isOk && pin.length < 4)}
                    data-testid={
                      isOk ? "desk-pin-submit" : isBk ? "desk-pin-backspace" : `desk-pin-digit-${key}`
                    }
                    onClick={() => {
                      if (isBk) onBackspace();
                      else if (isOk) submitPin(pin);
                      else onDigit(key);
                    }}
                    className={`min-h-[56px] rounded-xl border text-xl font-heading uppercase tracking-wider transition
                      ${
                        isOk
                          ? "border-[var(--brand,#00E5FF)]/60 bg-[var(--brand,#00E5FF)]/15 text-[var(--brand,#00E5FF)]"
                          : "border-white/10 bg-black/40 text-white hover:border-[var(--brand,#00E5FF)]/40"
                      }
                      disabled:opacity-40`}
                  >
                    {busy && isOk ? "…" : key}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-white/40 text-center">
              Sessão de 12h · sem login admin
            </p>
          </div>
        ) : (
          <div className="space-y-4" data-testid="desk-today-list">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-white/45">Hoje</div>
                <div className="text-lg text-white/90" data-testid="desk-today-date">
                  {dateLabel || "—"}
                </div>
              </div>
              <button
                type="button"
                onClick={loadToday}
                className="text-xs uppercase tracking-[0.2em] text-[var(--brand,#00E5FF)] min-h-[44px]"
                data-testid="desk-refresh"
              >
                Atualizar
              </button>
            </div>
            {err && (
              <div className="px-3 py-2 text-sm border-l-2 border-[var(--danger)] bg-[var(--danger)]/10" role="alert">
                {err}
              </div>
            )}
            {bookings.length === 0 ? (
              <div className="glass p-6 text-white/50 text-sm" data-testid="desk-empty">
                Nenhuma reserva confirmada/paga para hoje.
              </div>
            ) : (
              <ul className="space-y-3">
                {bookings.map((b) => {
                  const checked = Boolean(b.checked_in_at);
                  return (
                    <li
                      key={b.id}
                      data-testid={`desk-booking-${b.id}`}
                      className="glass p-4 flex items-center gap-3"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-heading text-2xl uppercase italic tracking-wide text-[var(--brand,#00E5FF)]">
                          {formatTime(b.start_time)}
                        </div>
                        <div className="text-sm text-white/90 truncate">{b.customer_name || "—"}</div>
                        <div className="text-[11px] text-white/45 truncate">
                          {b.whatsapp || ""}
                          {checked ? " · chegou" : ""}
                        </div>
                      </div>
                      {checked ? (
                        <button
                          type="button"
                          data-testid={`desk-undo-${b.id}`}
                          disabled={actionId === b.id}
                          onClick={() => undoChegou(b.id)}
                          className="btn-ghost inline-flex items-center gap-1.5 min-h-[44px] px-3 text-sm"
                        >
                          <RotateCcw className="w-4 h-4" /> Desfazer
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-testid={`desk-chegou-${b.id}`}
                          disabled={actionId === b.id}
                          onClick={() => markChegou(b.id)}
                          className="btn-neon inline-flex items-center gap-1.5 min-h-[44px] px-4 text-sm"
                        >
                          <Check className="w-4 h-4" />
                          {actionId === b.id ? "…" : "Chegou"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
