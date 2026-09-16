import React from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import WhatsAppFab from "@/components/WhatsAppFab";

export default function PageShell({ children, hideFooter = false, hideWhatsApp = false }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className={`flex-1 pt-[72px] ${hideWhatsApp ? "" : "pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]"}`}>{children}</main>
      {!hideFooter && <Footer />}
      {!hideWhatsApp && <WhatsAppFab />}
    </div>
  );
}
