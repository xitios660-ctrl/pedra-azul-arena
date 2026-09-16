export const HOME = {
  heroCta: "hero-cta-button",
  heroSecondary: "hero-secondary-button",
  navLogo: "nav-logo",
  navBook: "nav-book",
  navTournaments: "nav-tournaments",
  navAdmin: "nav-admin",
  navMyBookings: "nav-my-bookings",
  navFaq: "nav-faq",
  navLogin: "nav-login",          // discreet admin login
  navLogout: "nav-logout",
  menuCardBook: "menu-card-book",
  menuCardTournaments: "menu-card-tournaments",
  menuCardMyBookings: "menu-card-my-bookings",
};

export const AUTH = {
  loginForm: "login-form",
  loginEmail: "login-email-input",
  loginPassword: "login-password-input",
  loginSubmit: "login-submit-button",
  loginError: "login-error",
};

export const BOOKING = {
  page: "booking-page",
  courtCard: (id) => `court-card-${id}`,
  datePicker: "booking-date-picker",
  slot: (time) => `slot-${time}`,

  // Step 1 — Identification
  identifyModal: "identify-modal",
  cpfInput: "cpf-input",
  nameInput: "customer-name-input",
  whatsappInput: "whatsapp-input",
  identifyContinue: "identify-continue-button",
  identifyError: "identify-error",

  // Step 2 — Matchmaking
  matchmakingModal: "matchmaking-modal",
  yourTeamInput: "your-team-name-input",
  opponentTeamInput: "opponent-team-name-input",
  uploadYourCrest: "upload-your-crest-button",
  uploadOpponentCrest: "upload-opponent-crest-button",
  confirmReservation: "confirm-reservation-button",

  // Step 3 — PIX + Comprovante
  pixModal: "pix-modal",
  pixCopy: "pix-copy-paste",
  uploadComprovante: "upload-comprovante-button",
  comprovanteFileInput: "comprovante-file-input",
  pixCloseSuccess: "pix-success-close-button",
};

export const TOURN = {
  list: "tournaments-list",
  card: (id) => `tournament-card-${id}`,
  detail: "tournament-detail",
  bracket: "tournament-bracket",
  match: (id) => `match-${id}`,
  leaderboard: "tournament-leaderboard",
  topScorers: "tournament-top-scorers",
  empty: "tournaments-empty",
  skeleton: "tournaments-skeleton",
  interestCta: (id) => `tournament-interest-${id}`,
};

export const MYB = {
  page: "my-bookings-page",
  cpfLookupInput: "cpf-lookup-input",
  cpfLookupSubmit: "cpf-lookup-submit",
  lookupError: "cpf-lookup-error",
  bookingCard: (id) => `mybook-card-${id}`,
  payNow: (id) => `mybook-pay-${id}`,
  cancelBooking: (id) => `mybook-cancel-${id}`,
  rescheduleBooking: (id) => `mybook-reschedule-${id}`,
  uploadComprovante: (id) => `mybook-upload-comprovante-${id}`,
  receiptBooking: (id) => `mybook-receipt-${id}`,
};

export const ADMIN = {
  page: "admin-page",
  kpiRevenue: "admin-kpi-revenue",
  kpiOccupancy: "admin-kpi-occupancy",
  kpiConfirmed: "admin-kpi-confirmed",
  kpiAwaiting: "admin-kpi-awaiting",
  kpiTodayBookings: "admin-kpi-today-bookings",
  kpiFreeSlots: "admin-kpi-free-slots",
  kpiMonthRevenue: "admin-kpi-month-revenue",
  kpiNextUpcoming: "admin-kpi-next-upcoming",
  kpiTopHours: "admin-kpi-top-hours",
  bookingRow: (id) => `admin-booking-${id}`,
  viewComprovante: (id) => `admin-view-comprovante-${id}`,
  confirmBooking: (id) => `admin-confirm-${id}`,
  cancelBooking: (id) => `admin-cancel-${id}`,
  rescheduleBooking: (id) => `admin-reschedule-${id}`,
  noShowBooking: (id) => `admin-noshow-${id}`,
  rejectBooking: (id) => `admin-reject-${id}`,
  kpiNoShow: "admin-kpi-noshow",
  kpiCheckedIn: "admin-kpi-checked-in",
  checkInBooking: (id) => `admin-checkin-${id}`,
  undoCheckInBooking: (id) => `admin-checkin-undo-${id}`,
  notesBooking: (id) => `admin-notes-${id}`,
  notesSave: (id) => `admin-notes-save-${id}`,
  openReceipt: (id) => `admin-receipt-${id}`,
  awaitingQueue: "admin-awaiting-queue",
  sendWhatsapp: (id) => `admin-send-whatsapp-${id}`,
  tournamentSelect: "admin-tournament-select",
  scoreInputA: (id) => `score-a-${id}`,
  scoreInputB: (id) => `score-b-${id}`,
  saveScore: (id) => `save-score-${id}`,
  siteSettings: "admin-site-settings",
  siteSettingsSave: "admin-site-settings-save",
  exportCsv: "admin-export-csv",
  bookingsDateFrom: "admin-bookings-date-from",
  bookingsDateTo: "admin-bookings-date-to",
  bookingsSearch: "admin-bookings-search",
  bookingsEmpty: "admin-bookings-empty",
  revenueTab: "admin-revenue-tab",
  revenueDateFrom: "admin-revenue-date-from",
  revenueDateTo: "admin-revenue-date-to",
  revenueExport: "admin-revenue-export-csv",
  revenueTotals: "admin-revenue-totals",
  revenueTable: "admin-revenue-table",
};

export const FAQ = {
  page: "faq-page",
  accordion: "faq-accordion",
  empty: "faq-empty",
  itemPrefix: "faq-item-",
  mapsLink: "faq-maps-link",
  ctaBand: "faq-cta-band",
  ctaBook: "faq-cta-book",
  ctaWhatsapp: "faq-cta-whatsapp",
};

export const DESK = {
  page: "desk-checkin-page",
  pinPad: "desk-pin-pad",
  pinSubmit: "desk-pin-submit",
  pinError: "desk-pin-error",
  logout: "desk-logout",
  todayList: "desk-today-list",
  chegou: (id) => `desk-chegou-${id}`,
  undo: (id) => `desk-undo-${id}`,
};
