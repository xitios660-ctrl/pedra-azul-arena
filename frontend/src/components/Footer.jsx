import React from "react";
import { Instagram, Phone, MapPin, Mail, MessageCircle } from "lucide-react";
import {
  WHATSAPP_DISPLAY,
  whatsappUrl,
  defaultWhatsAppPrefill,
} from "@/lib/siteConfig";

export default function Footer() {
  const waHref = whatsappUrl(defaultWhatsAppPrefill());

  return (
    <footer className="border-t border-white/5 mt-24 py-10 bg-black/60">
      {/* WhatsApp reinforcement band */}
      <div className="max-w-7xl mx-auto px-6 md:px-10 mb-10">
        <div className="glass p-6 md:p-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6 border-[var(--brand)]/20">
          <div>
            <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2">
              // Contato · WhatsApp
            </div>
            <h3 className="font-heading text-3xl md:text-4xl uppercase italic leading-none">
              Tire dúvidas e <span className="text-[#25D366]">reserve</span>
            </h3>
            <p className="text-white/55 text-sm mt-2 max-w-lg">
              Dúvidas, horários ou confirmação de reserva — fale com a gente no WhatsApp{" "}
              <strong className="text-white">{WHATSAPP_DISPLAY}</strong>.
            </p>
          </div>
          <a
            href={waHref}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="footer-whatsapp-cta"
            className="btn-neon !bg-gradient-to-r from-[#25D366] to-[#128C7E] !shadow-[0_0_28px_rgba(37,211,102,0.45)] shrink-0"
            aria-label={`Abrir WhatsApp ${WHATSAPP_DISPLAY}`}
          >
            <MessageCircle className="w-5 h-5" /> Falar no WhatsApp
          </a>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 md:px-10 grid md:grid-cols-4 gap-8">
        <div>
          <div className="flex items-center gap-3 mb-3">
            <img src="/assets/copa-alto-tiete.png" alt="Copa Alto Tietê"
              className="w-12 h-12 object-contain" />
            <div className="font-heading text-2xl uppercase italic tracking-wider leading-none">
              Até a <span className="text-[var(--brand)]">Pedra Azul</span>
            </div>
          </div>
          <p className="text-white/50 text-sm mt-3 max-w-xs">
            Casa do <strong className="text-white">Pedra Azul F.S.</strong> — fundado em 19.04.15.
            Quadra única no Núncio. Reserve sua partida e dispute a Copa Alto Tietê.
          </p>
        </div>
        <div>
          <div className="text-[11px] tracking-[0.3em] uppercase text-[var(--accent)] mb-3">Contato</div>
          <div className="text-white/70 text-sm space-y-2">
            <div className="flex items-center gap-2"><Mail className="w-3.5 h-3.5 text-[var(--brand)]" /> contato@pedraazulfs.com.br</div>
            <a
              href={waHref}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-[var(--brand)] transition-colors"
            >
              <Phone className="w-3.5 h-3.5 text-[var(--brand)]" /> {WHATSAPP_DISPLAY}
            </a>
            <div className="flex items-center gap-2"><Instagram className="w-3.5 h-3.5 text-[var(--brand)]" /> @pedraazulfs</div>
            <div className="flex items-center gap-2"><MapPin className="w-3.5 h-3.5 text-[var(--brand)]" /> Núncio · Alto Tietê · SP</div>
          </div>
        </div>
        <div>
          <div className="text-[11px] tracking-[0.3em] uppercase text-[var(--accent)] mb-3">Horários</div>
          <div className="text-white/70 text-sm space-y-1">
            <div>Segunda — Sexta · 08:00 — 23:00</div>
            <div>Sábado · 09:00 — 23:00</div>
            <div>Domingo · 09:00 — 22:00</div>
          </div>
        </div>
        <div>
          <div className="text-[11px] tracking-[0.3em] uppercase text-[var(--accent)] mb-3">Valor</div>
          <div className="text-white/70 text-sm space-y-1">
            <div className="font-heading text-3xl text-white">R$ 130<span className="text-white/50 text-sm">/h</span></div>
            <div className="text-white/60">Quadra Pedra Azul · Núncio</div>
            <div className="text-[var(--accent)] text-xs mt-2">30% OFF de sinal no PIX</div>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 md:px-10 mt-10 text-[11px] uppercase tracking-[0.3em] text-white/30 flex flex-wrap items-center justify-between gap-2">
        <span>© 2026 Pedra Azul F.S. · Todos os direitos reservados</span>
        <span>Copa Alto Tietê · Temporada 2026</span>
      </div>
    </footer>
  );
}
