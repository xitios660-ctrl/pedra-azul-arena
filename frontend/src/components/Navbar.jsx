import React from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { HOME } from "@/constants/testIds";
import { Trophy, CalendarDays, ShieldCheck, LogOut, Ticket, Lock, MessageCircle } from "lucide-react";
import { useSiteSettings } from "@/lib/SiteSettings";

export default function Navbar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { settings, waHref, waReady } = useSiteSettings();
  const waDisplay = settings.whatsapp_display;

  const isAdmin = user && user.role === "admin";

  const navItem = (to, label, testId, icon) => (
    <Link
      to={to}
      data-testid={testId}
      className={`relative font-heading uppercase tracking-[0.2em] text-[15px] px-3 py-2 transition-colors ${
        pathname === to ? "text-[var(--brand)]" : "text-white/80 hover:text-white"
      }`}
    >
      <span className="inline-flex items-center gap-2">{icon}{label}</span>
      {pathname === to && (
        <motion.span
          layoutId="nav-underline"
          className="absolute left-2 right-2 -bottom-0.5 h-[2px] bg-[var(--brand)]"
          style={{ filter: "drop-shadow(0 0 8px var(--brand-glow))" }}
        />
      )}
    </Link>
  );

  return (
    <header className="fixed top-0 left-0 right-0 z-50">
      <div className="glass-strong border-b border-white/10 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 md:px-10 py-3 flex items-center justify-between">
          <Link to="/" data-testid={HOME.navLogo} className="flex items-center gap-3 group">
            <img src="/assets/copa-alto-tiete.png" alt="Copa Alto Tietê"
              className="w-12 h-12 object-contain"
              style={{ filter: "drop-shadow(0 0 12px rgba(255,107,0,0.55))" }} />
            <div className="leading-none">
              <div className="font-heading text-2xl tracking-[0.1em] uppercase">
                <span className="italic">Até a</span> <span className="text-[var(--brand)]">Pedra Azul</span>
              </div>
              <div className="text-[10px] tracking-[0.4em] text-white/55 uppercase mt-0.5">Quadra Núncio · Copa Alto Tietê</div>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-2">
            {navItem("/booking", "Reservar", HOME.navBook, <CalendarDays className="w-4 h-4" />)}
            {navItem("/tournaments", "Campeonatos", HOME.navTournaments, <Trophy className="w-4 h-4" />)}
            {navItem("/minhas-reservas", "Minhas Reservas", HOME.navMyBookings, <Ticket className="w-4 h-4" />)}
            {isAdmin && navItem("/admin", "Admin", HOME.navAdmin, <ShieldCheck className="w-4 h-4" />)}
          </nav>

          <div className="flex items-center gap-2">
            {waReady && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`WhatsApp ${waDisplay}`}
                title={`WhatsApp ${waDisplay}`}
                data-testid="nav-whatsapp"
                className="hidden sm:inline-flex text-[#25D366] hover:text-[#3dff82] transition-colors p-2 min-w-[44px] min-h-[44px] items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#25D366]"
              >
                <MessageCircle className="w-5 h-5" />
              </a>
            )}
            {isAdmin ? (
              <>
                <span className="hidden md:inline text-[10px] uppercase tracking-[0.3em] text-[var(--brand)]">
                  ADMIN · {user.name?.split(" ")[0]}
                </span>
                <button
                  data-testid={HOME.navLogout}
                  onClick={async () => { await logout(); navigate("/"); }}
                  className="btn-ghost !py-2 !px-4 !text-[14px]"
                >
                  <LogOut className="w-4 h-4" /> Sair
                </button>
              </>
            ) : (
              <Link
                to="/login"
                data-testid={HOME.navLogin}
                className="text-white/55 hover:text-[var(--brand)] transition-colors p-2 min-w-[44px] min-h-[44px] inline-flex items-center justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
                title="Acesso restrito"
                aria-label="Acesso restrito do administrador"
              >
                <Lock className="w-4 h-4" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
