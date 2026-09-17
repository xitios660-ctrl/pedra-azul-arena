import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { CloudRain, MessageCircle, ShieldCheck, WifiOff } from "lucide-react";

export default function ArenaExperienceLayer() {
  const location = useLocation();
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const isHome = location.pathname === "/";
  const isAdmin = location.pathname === "/admin";

  return (
    <>
      {!online && (
        <div className="fixed inset-x-3 top-3 z-[10050] rounded-2xl border border-yellow-300/30 bg-[#181507]/95 px-4 py-3 text-sm text-yellow-100 shadow-2xl backdrop-blur-xl flex items-center gap-3" role="status">
          <WifiOff className="w-4 h-4 shrink-0" />
          Sua internet caiu. As telas continuam abertas, mas reservas e ações do admin precisam de conexão.
        </div>
      )}

      {isHome && (
        <div className="fixed left-3 sm:left-5 bottom-[calc(5.2rem+env(safe-area-inset-bottom,0px))] sm:bottom-5 z-[45] pointer-events-none">
          <div className="pointer-events-auto max-w-[310px] rounded-2xl border border-[var(--brand)]/25 bg-black/70 px-4 py-3 backdrop-blur-xl shadow-[0_14px_45px_rgba(0,0,0,0.42)]">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand)]/10 grid place-items-center shrink-0">
                <CloudRain className="w-4 h-4 text-[var(--brand)]" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--brand)]">Quadra coberta</div>
                <div className="text-sm font-semibold text-white mt-0.5">Futsal faça chuva ou faça sol.</div>
                <div className="text-[11px] text-white/45 mt-1 leading-relaxed">Ambiente coberto e iluminado para peladas e treinos.</div>
                <Link to="/booking" className="inline-flex items-center gap-2 mt-2 text-xs font-semibold uppercase tracking-[0.16em] text-white hover:text-[var(--brand)] transition-colors">
                  <ShieldCheck className="w-3.5 h-3.5" /> Reservar horário
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
        <Link
          to="/admin/whatsapp"
          className="fixed right-3 sm:right-5 bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] z-[70] inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-[#07110c]/92 px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-emerald-200 shadow-[0_14px_42px_rgba(0,0,0,0.45)] backdrop-blur-xl hover:border-emerald-300/60 hover:text-white transition"
          aria-label="Abrir central do WhatsApp Baileys"
        >
          <MessageCircle className="w-4 h-4" /> Central WhatsApp
        </Link>
      )}
    </>
  );
}
