import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);   // null = unknown/loading, false = anon, obj = signed in
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch (e) {
      setUser(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login = async (email, password) => {
    const { data } = await api.post("/auth/login", { email, password });
    if (data.access_token) localStorage.setItem("arena_token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const register = async (name, email, password) => {
    const { data } = await api.post("/auth/register", { name, email, password });
    if (data.access_token) localStorage.setItem("arena_token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch {}
    localStorage.removeItem("arena_token");
    setUser(false);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout, refresh, formatApiErrorDetail }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
