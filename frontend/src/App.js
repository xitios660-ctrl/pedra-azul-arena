import "@/index.css";
import React, { Suspense, lazy } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import IntroVideoModal from "@/components/IntroVideoModal";
import { SiteSettingsProvider } from "@/lib/SiteSettings";

const Booking = lazy(() => import("@/pages/Booking"));
const MyBookings = lazy(() => import("@/pages/MyBookings"));
const AdminDashboard = lazy(() => import("@/pages/Admin"));
const Presentation = lazy(() => import("@/pages/Presentation"));
const TournamentsList = lazy(() =>
  import("@/pages/Tournaments").then((m) => ({ default: m.TournamentsList }))
);
const TournamentDetail = lazy(() =>
  import("@/pages/Tournaments").then((m) => ({ default: m.TournamentDetail }))
);
const Faq = lazy(() => import("@/pages/Faq"));
const DeskCheckIn = lazy(() => import("@/pages/DeskCheckIn"));

/** Neon skeleton fallback matching Pedra Azul dark + cyan brand */
function NeonRouteFallback() {
  return (
    <div
      className="min-h-screen flex items-center justify-center bg-[var(--bg-base,#030305)] px-6"
      aria-busy="true"
      aria-label="Carregando"
      data-testid="route-lazy-fallback"
    >
      <div className="w-full max-w-sm space-y-4">
        <div className="flex justify-center">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-[var(--brand,#00E5FF)] animate-pulse shadow-[0_0_14px_var(--brand-glow,rgba(0,229,255,0.45))]" />
        </div>
        <div className="h-3 w-28 mx-auto rounded bg-[var(--brand,#00E5FF)]/35 animate-pulse" />
        <div className="h-24 rounded border border-[var(--brand,#00E5FF)]/25 bg-[var(--bg-surface,#0C0C12)] overflow-hidden relative">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--brand,#00E5FF)]/15 to-transparent animate-pulse" />
        </div>
        <div className="h-2 w-3/4 mx-auto rounded bg-white/10 animate-pulse" />
        <div className="h-2 w-1/2 mx-auto rounded bg-white/10 animate-pulse" />
        <p className="text-center text-[11px] tracking-[0.35em] uppercase text-[var(--brand,#00E5FF)]/70 pt-2">
          Carregando…
        </p>
      </div>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SiteSettingsProvider>
        <IntroVideoModal />
        <Suspense fallback={<NeonRouteFallback />}>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/booking" element={<Booking />} />
          <Route path="/minhas-reservas" element={<MyBookings />} />
          <Route path="/tournaments" element={<TournamentsList />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/admin" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
          <Route path="/apresentacao" element={<Presentation />} />
          <Route path="/faq" element={<Faq />} />
          <Route path="/perguntas" element={<Navigate to="/faq" replace />} />
          <Route path="/balcao" element={<DeskCheckIn />} />
          <Route path="/checkin" element={<DeskCheckIn />} />
          {/* Legacy redirects */}
          <Route path="/me" element={<Navigate to="/minhas-reservas" replace />} />
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </SiteSettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
