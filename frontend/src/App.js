import "@/index.css";
import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/lib/auth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import Landing from "@/pages/Landing";
import Login from "@/pages/Login";
import Booking from "@/pages/Booking";
import MyBookings from "@/pages/MyBookings";
import { TournamentsList, TournamentDetail } from "@/pages/Tournaments";
import AdminDashboard from "@/pages/Admin";
import Presentation from "@/pages/Presentation";
import IntroVideoModal from "@/components/IntroVideoModal";
import { SiteSettingsProvider } from "@/lib/SiteSettings";

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <SiteSettingsProvider>
        <IntroVideoModal />
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/booking" element={<Booking />} />
          <Route path="/minhas-reservas" element={<MyBookings />} />
          <Route path="/tournaments" element={<TournamentsList />} />
          <Route path="/tournaments/:id" element={<TournamentDetail />} />
          <Route path="/admin" element={<ProtectedRoute adminOnly><AdminDashboard /></ProtectedRoute>} />
          <Route path="/apresentacao" element={<Presentation />} />
          {/* Legacy redirects */}
          <Route path="/me" element={<Navigate to="/minhas-reservas" replace />} />
          <Route path="/register" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </SiteSettingsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
