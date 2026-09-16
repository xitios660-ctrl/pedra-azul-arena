import React, { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { X, Info, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useSiteSettings } from "@/lib/SiteSettings";

const DISMISS_PREFIX = "pa_announcement_dismiss:";

const STYLE_MAP = {
  info: {
    wrap: "bg-[var(--brand)]/15 border-[var(--brand)]/40 text-white",
    icon: Info,
    iconClass: "text-[var(--brand)]",
  },
  warning: {
    wrap: "bg-amber-500/15 border-amber-400/40 text-amber-50",
    icon: AlertTriangle,
    iconClass: "text-amber-300",
  },
  success: {
    wrap: "bg-emerald-500/15 border-emerald-400/40 text-emerald-50",
    icon: CheckCircle2,
    iconClass: "text-emerald-300",
  },
};

/** Dismissible site announcement under the navbar (Landing + Booking). */
export default function AnnouncementBanner({ paths = ["/", "/booking"] }) {
  const { pathname } = useLocation();
  const { settings } = useSiteSettings();
  const enabled = settings?.announcement_enabled === true;
  const text = String(settings?.announcement_text || "").trim();
  const styleKey = ["info", "warning", "success"].includes(settings?.announcement_style)
    ? settings.announcement_style
    : "info";
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (!enabled || !text) {
      setHidden(true);
      return;
    }
    try {
      setHidden(sessionStorage.getItem(DISMISS_PREFIX + text) === "1");
    } catch (_) {
      setHidden(false);
    }
  }, [enabled, text]);

  const onPath = Array.isArray(paths) ? paths.includes(pathname) : true;
  if (!onPath || !enabled || !text || hidden) return null;

  const cfg = STYLE_MAP[styleKey] || STYLE_MAP.info;
  const Icon = cfg.icon;

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_PREFIX + text, "1");
    } catch (_) {
      /* private mode — still hide for this mount */
    }
    setHidden(true);
  };

  return (
    <div
      role="status"
      data-testid="site-announcement-banner"
      data-style={styleKey}
      className={`sticky top-0 z-40 border-b ${cfg.wrap}`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 py-2.5 flex items-start gap-3">
        <Icon className={`w-5 h-5 shrink-0 mt-0.5 ${cfg.iconClass}`} aria-hidden />
        <p className="flex-1 text-sm leading-snug pt-0.5" data-testid="site-announcement-text">
          {text}
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dispensar aviso"
          data-testid="site-announcement-dismiss"
          className="shrink-0 min-w-[44px] min-h-[44px] -mr-2 -mt-1 inline-flex items-center justify-center rounded-lg text-white/70 hover:text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
