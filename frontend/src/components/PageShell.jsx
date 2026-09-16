import React from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WhatsAppFab from "@/components/WhatsAppFab";
import AnnouncementBanner from "@/components/AnnouncementBanner";
import { useSiteSettings } from "@/lib/SiteSettings";

export default function PageShell({ children, hideFooter = false, hideWhatsApp = false }) {
  const { waReady } = useSiteSettings();
  const showFab = !hideWhatsApp && waReady;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <div className={`pt-[72px] flex-1 flex flex-col ${showFab ? "pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]" : ""}`}>
        <AnnouncementBanner />
        <main className="flex-1">{children}</main>
        {!hideFooter && <Footer />}
      </div>
      {showFab && <WhatsAppFab />}
    </div>
  );
}
