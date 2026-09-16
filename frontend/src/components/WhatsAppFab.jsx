import React from "react";
import { motion } from "framer-motion";
import { MessageCircle } from "lucide-react";
import { defaultWhatsAppPrefill, whatsappUrl } from "@/lib/siteConfig";
import { useSiteSettings } from "@/lib/SiteSettings";

/**
 * Floating WhatsApp balloon (FAB) — fixed bottom-right, brand green, subtle pulse.
 * Hidden while site WhatsApp is still the seed placeholder (avoids fake number chats).
 */
export default function WhatsAppFab({ prefill } = {}) {
  const { settings, waReady } = useSiteSettings();

  if (!waReady) return null;

  const href = whatsappUrl(prefill || defaultWhatsAppPrefill(), settings.whatsapp_e164);
  const label = `Abrir WhatsApp ${settings.whatsapp_display} — Fale no WhatsApp`;

  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      title={label}
      data-testid="whatsapp-fab"
      className="whatsapp-fab fixed z-[70] right-5 md:right-8 flex items-center justify-center w-14 h-14 md:w-16 md:h-16 rounded-full text-white shadow-lg"
      style={{
        background: "linear-gradient(145deg, #25D366 0%, #128C7E 100%)",
        boxShadow: "0 0 0 0 rgba(37, 211, 102, 0.55), 0 8px 28px rgba(0,0,0,0.45)",
        bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
      }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 260, damping: 18, delay: 0.4 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
    >
      <span className="whatsapp-fab-pulse absolute inset-0 rounded-full pointer-events-none" aria-hidden />
      <MessageCircle className="w-7 h-7 md:w-8 md:h-8 relative z-10" strokeWidth={2.2} fill="currentColor" />
    </motion.a>
  );
}
