import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import api from "@/lib/api";
import {
  DEFAULT_SITE_SETTINGS,
  priceLabel,
  whatsappUrl,
  defaultWhatsAppPrefill,
  isWhatsAppPlaceholder,
  isPixKeyPlaceholder,
} from "@/lib/siteConfig";

const Ctx = createContext({
  settings: DEFAULT_SITE_SETTINGS,
  loading: true,
  refresh: async () => {},
  waHref: whatsappUrl(defaultWhatsAppPrefill()),
  waReady: false,
  pixReady: false,
  priceLabel: priceLabel(130),
});

export function SiteSettingsProvider({ children }) {
  const [settings, setSettings] = useState(DEFAULT_SITE_SETTINGS);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      const { data } = await api.get("/site-settings");
      setSettings({ ...DEFAULT_SITE_SETTINGS, ...data });
    } catch (_) {
      /* keep defaults */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const value = useMemo(() => {
    const waReady = !isWhatsAppPlaceholder(settings);
    const pixReady = !isPixKeyPlaceholder(settings);
    return {
      settings,
      loading,
      refresh,
      waHref: waReady
        ? whatsappUrl(defaultWhatsAppPrefill(), settings.whatsapp_e164)
        : null,
      waReady,
      pixReady,
      priceLabel: priceLabel(settings.price_per_hour),
    };
  }, [settings, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSiteSettings() {
  return useContext(Ctx);
}
