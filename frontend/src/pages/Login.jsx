import React, { useState } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import PageShell from "@/components/PageShell";
import { useAuth } from "@/lib/auth";
import { AUTH } from "@/constants/testIds";
import { Mail, Lock, ChevronRight, ShieldCheck } from "lucide-react";

const HERO_IMG = "https://images.unsplash.com/photo-1779406283467-5124ba4631c3?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjY2NjV8MHwxfHNlYXJjaHwxfHxkYXJrJTIwZnV0c2FsJTIwc3RhZGl1bSUyMG5pZ2h0fGVufDB8fHx8MTc4MDk2OTUxMXww&ixlib=rb-4.1.0&q=85";

export default function Login() {
  const { login, formatApiErrorDetail } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(""); setSubmitting(true);
    try {
      const user = await login(email.trim(), password);
      const next = location.state?.from || (user.role === "admin" ? "/admin" : "/");
      navigate(next, { replace: true });
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally { setSubmitting(false); }
  };

  return (
    <PageShell hideFooter hideWhatsApp>
      <div className="relative min-h-[calc(100vh-72px)] grid md:grid-cols-2">
        {/* Left visual */}
        <div className="relative hidden md:block overflow-hidden">
          <img src={HERO_IMG} alt="" className="absolute inset-0 w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#030305] via-black/40 to-black/10" />
          <div className="absolute inset-0 bg-grid opacity-30" />
          <div className="absolute bottom-12 left-12 right-12">
            <div className="skew-tag mb-4"><span className="font-heading uppercase text-xs tracking-[0.4em] text-[var(--brand)]">Access Pass</span></div>
            <h2 className="font-heading text-6xl uppercase italic leading-[0.9]">
              Bem-vindo<br/>de <span className="text-[var(--brand)]">volta</span>.
            </h2>
            <p className="mt-4 text-white/60 max-w-sm">Entre na arena e continue construindo sua carreira no futsal de elite.</p>
          </div>
        </div>

        {/* Form */}
        <div className="relative flex items-center justify-center p-6 md:p-16">
          <motion.form
            data-testid={AUTH.loginForm}
            onSubmit={onSubmit}
            initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-md glass-strong p-8 md:p-10"
          >
            <div className="text-[11px] tracking-[0.3em] uppercase text-[var(--brand)] mb-3">// ADMIN LOGIN</div>
            <h1 className="font-heading text-5xl uppercase italic leading-[0.9]">Acesso <span className="text-[var(--brand)]">restrito</span></h1>
            <p className="text-white/50 mt-2 text-sm">Área exclusiva para administradores da arena. Clientes não precisam de login — acessem por <a href="/minhas-reservas" className="text-[var(--brand)]">Minhas Reservas</a>.</p>

            <div className="mt-8 space-y-5">
              <Field icon={<Mail className="w-4 h-4" />} label="Email">
                <input
                  data-testid={AUTH.loginEmail}
                  type="email" autoComplete="email" required
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  className="bg-transparent w-full focus:outline-none text-white placeholder-white/30"
                  placeholder="seu e-mail"
                />
              </Field>
              <Field icon={<Lock className="w-4 h-4" />} label="Senha">
                <input
                  data-testid={AUTH.loginPassword}
                  type="password" autoComplete="current-password" required
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  className="bg-transparent w-full focus:outline-none text-white placeholder-white/30"
                  placeholder="••••••••"
                />
              </Field>
            </div>

            {error && (
              <div data-testid={AUTH.loginError} className="mt-5 px-4 py-3 text-sm border-l-2 border-[var(--danger)] bg-[var(--danger)]/10 text-white/90">
                {error}
              </div>
            )}

            <button
              data-testid={AUTH.loginSubmit}
              type="submit" disabled={submitting}
              className="btn-neon w-full justify-center mt-7"
            >
              {submitting ? "Entrando…" : (<>Entrar <ChevronRight className="w-5 h-5" /></>)}
            </button>

            <div className="mt-6 text-sm text-white/50 flex items-center justify-between">
              <span>Não é admin?</span>
              <a href="/minhas-reservas" className="text-[var(--brand)] hover:text-glow-brand uppercase tracking-[0.2em] text-xs">Minhas Reservas →</a>
            </div>

            <div className="mt-6 text-[10px] text-white/30 uppercase tracking-[0.3em] flex items-center gap-2">
              <ShieldCheck className="w-3 h-3 text-[var(--brand)]" /> Conexão segura · JWT
            </div>
          </motion.form>
        </div>
      </div>
    </PageShell>
  );
}

export function Field({ icon, label, children }) {
  return (
    <label className="block">
      <div className="text-[10px] tracking-[0.35em] uppercase text-white/40 mb-2">{label}</div>
      <div className="flex items-center gap-3 px-4 py-3 bg-black/40 border border-white/10 focus-within:border-[var(--brand)] transition-colors">
        <span className="text-[var(--brand)]" aria-hidden="true">{icon}</span>
        {children}
      </div>
    </label>
  );
}
