# Arena Futsal Premium — PRD

## Original Problem Statement
Build "Arena Futsal Premium (Estilo FIFA)" — a premium, ultra-modern web application for a high-end Futsal arena heavily inspired by EA Sports FC / FIFA video-game UI/UX. Must feel cinematic, like a $70k custom solution. Pillars: Estética, Funcionalidade, Gestão.

## User Choices (Iteration 1)
- **Scope**: Full MVP (Landing + Reservas + PIX + Campeonatos + Admin)
- **Auth**: Email/senha JWT customizado
- **PIX**: MOCKED (QR fake + "Simular Pagamento")
- **Brand**: Azul elétrico #00E5FF sobre preto
- **Admin**: Pré-seeded
- **Apresentação cinematográfica** explicitly requested

## Architecture
- **Backend**: FastAPI + Motor (async MongoDB) + bcrypt + PyJWT. All routes under `/api`. PyObjectId not used (UUID `id` strings throughout for simpler JSON serialization, no Mongo `_id` leakage).
- **Frontend**: React 19 + react-router-dom 7 + framer-motion + Tailwind. Cinematic UI with Teko/Rajdhani headings, Exo 2 body, glassmorphism, neon glow, scanline overlay, skewed CTAs, animated stat ticker, parallax/hover scale on menu cards.
- **State**: AuthContext via React Context; axios instance with `withCredentials: true` + Bearer token interceptor.

## Implemented (Jan 2026)
- ✅ Cinematic landing page (hero JOGUE/DOMINE/SEJA LENDA, stat ticker, 3 FIFA-style menu cards, feature band)
- ✅ JWT auth (login/register/me/logout) + idempotent admin seeding + demo user
- ✅ 3 courts, hourly availability (08:00–23:00), 30% PIX deposit
- ✅ Booking flow with Matchmaking modal (team names + 12 crests) → PIX mock modal → success modal
- ✅ MOCKED PIX (QR icon + copia-e-cola string + Simulate Payment button)
- ✅ Profile (/me) — list user bookings with status, pay/cancel actions
- ✅ Tournaments hub — 2 seeded tournaments (Copa Arena Premium knockout + Liga Relâmpago league)
- ✅ Knockout bracket UI with team crests + score + winner glow
- ✅ League standings (P/W/D/L/GF/GA/GD/Pts) with crown for leader
- ✅ Top scorers list + match history tab
- ✅ Admin dashboard — KPIs (revenue, occupancy %, confirmed, pending), 7-day revenue bar chart, top times
- ✅ Admin bookings table with Confirmar/Cancelar
- ✅ Admin tournament score editor with auto knockout advancement
- ✅ Protected routes (ProtectedRoute / adminOnly)
- ✅ Comprehensive data-testid coverage for QA automation
- ✅ Test coverage: 26/26 backend pytest + 100% frontend critical flows

## Iteration 2 — Premium Cinematic Presentation Video (Jun 2026)
- ✅ New `/apresentacao` route with 8-scene auto-playing cinematic presentation (~52 seconds total)
  - Scene 1: Cold Open — "Arena Premium · presents"
  - Scene 2: Logo Reveal — animated zap icon + ARENA PREMIUM logotype with scanning beam
  - Scene 3: Stadium Reveal — "O ESTÁDIO DOS LENDÁRIOS" letter-by-letter reveal
  - Scene 4: Reservar — animated time slot list with selection highlight
  - Scene 5: Torneios — animated match-card knockout previews with winner glow
  - Scene 6: PIX 30% OFF — animated mock QR code with scanning beam
  - Scene 7: Stats Showcase — 6 count-up KPI cards
  - Scene 8: Final CTA — "SEJA LENDA" + "ENTRAR NA ARENA" button → /booking
- ✅ Cinematic letterbox (top/bottom 8vh black bars sliding in)
- ✅ HUD: REC indicator, scene chapter counter, progress bars per scene, total time
- ✅ Controls: audio toggle, play/pause, "Pular intro", replay after end
- ✅ Original synthesized cinematic score via WebAudio API (cinematic pad + sub-bass pulse + sparkle arpeggio)
- ✅ Floating neon particles, parallax zoom on background images, framer-motion staggered reveals
- ✅ Landing page CTA added: "Assistir Apresentação" button next to hero
- ✅ All flows tested 100% pass (auto-advance, audio toggle, pause/resume, skip, final CTA navigation)

## User Personas
1. **Jogador casual** — quer reservar uma quadra rapidamente, paga PIX, leva o time
2. **Capitão de time** — gerencia partidas recorrentes, dispute torneios
3. **Admin (gestor da arena)** — controla reservas, edita placares de torneios, monitora ocupação/receita

## Backlog (P1)
- [ ] Pagamento PIX real (Mercado Pago/Asaas/Stripe) com webhook
- [ ] Upload de escudo personalizado (não só emojis)
- [ ] Notificações por email/Whatsapp (confirmação + reminder)
- [ ] Página pública de detalhe da partida (compartilhável)
- [ ] Modo "Career Mode" no perfil — estatísticas de gols, vitórias, ranking pessoal

## Backlog (P2)
- [ ] Recuperação de senha (forgot/reset password)
- [ ] OAuth Google
- [ ] Loading skeletons no admin dashboard
- [ ] Empty-state ilustrado em /me
- [ ] Stream/replay automático
- [ ] Marketplace de equipamentos

## Iteration 4 — Final adjustments per user request (Jun 2026)
- ❌ Removed music/audio toggle and Skank YouTube button from intro (clean cinematic-only intro)
- ✅ Single court: "Quadra Pedra Azul — Núncio" · R$ 130/hora (backend COURTS reduced from 3 to 1)
- ✅ Main logo switched to Copa Alto Tietê (Navbar, Footer, Intro central stage, favicon)
- ✅ Pedra Azul F.S. logo redesigned as clean SVG (diamond + crown + banner) — now shown as secondary mark
- ✅ Intro now shows: location "Quadra Pedra Azul · Núncio", "Fundado 19.04.15 · Copa Alto Tietê 2026", R$ 130/HORA prominent badge
- ✅ Navbar subtitle: "Quadra Núncio · Copa Alto Tietê"
- ✅ Footer simplified to single price R$ 130/h
- ✅ Landing stats: "Quadra Oficial: 1"
- ✅ Document title + favicon updated
