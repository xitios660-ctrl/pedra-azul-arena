/**
 * HTTP client from WhatsApp sidecar → FastAPI (same host, internal token).
 */
const API_BASE = (process.env.API_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 8000}`).replace(/\/$/, "");
const TOKEN = process.env.WHATSAPP_INTERNAL_TOKEN || "";

function headers() {
  const h = { Accept: "application/json", "Content-Type": "application/json" };
  if (TOKEN) h["X-Internal-Token"] = TOKEN;
  return h;
}

async function req(method, path, body) {
  const url = `${API_BASE}/api${path}`;
  const opts = { method, headers: headers() };
  if (body != null) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    data = await res.json();
  } else {
    data = { detail: await res.text() };
  }
  if (!res.ok) {
    const err = new Error(data?.detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  availability: (date, afterHour) => {
    const q = new URLSearchParams({ date });
    if (afterHour != null) q.set("after_hour", String(afterHour));
    return req("GET", `/internal/whatsapp/availability?${q}`);
  },
  createBooking: (payload) => req("POST", "/internal/whatsapp/bookings", payload),
  listByPhone: (phone) => req("GET", `/internal/whatsapp/bookings?phone=${encodeURIComponent(phone)}`),
  cancelByPhone: (phone, bookingId) =>
    req("POST", "/internal/whatsapp/bookings/cancel", { phone, booking_id: bookingId || null }),
  dueReminders: () => req("GET", "/internal/whatsapp/reminders/due"),
  markReminderSent: (bookingId) =>
    req("POST", `/internal/whatsapp/reminders/${bookingId}/sent`, {}),
};
