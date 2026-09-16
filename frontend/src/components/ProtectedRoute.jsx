import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";

export function ProtectedRoute({ children, adminOnly = false }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="min-h-screen grid place-items-center text-white/60 font-display tracking-widest">Carregando…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== "admin") return <Navigate to="/" replace />;
  return children;
}
