/**
 * HTTP client from WhatsApp sidecar → FastAPI (same host, internal token).
 */
const API_BASE = (process.env.API_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT || 8000}`).replace(/\/$/, "");
const TOKEN = (
  process.env.INTERNAL_API_TOKEN ||
  process.env.WHATSAPP_INTERNAL_TOKEN ||
  ""
).trim();

function headers(json = true) {
  const h = { Accept: "application/json" };
  if (json) h["Content-Type"] = "application/json";
  if (TOKEN) h["X-Internal-Token"] = TOKEN;
  return h;
}


async function req(method, path, body) {
  const url = `${API_BASE}/api${path}`;
  const opts = { method, headers: headers(true) };
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

async function uploadComprovante(phone, buffer, filename = "comprovante.jpg", bookingId = null) {
  const url = `${API_BASE}/api/internal/whatsapp/comprovante`;
  const form = new FormData();
  form.append("phone", String(phone || ""));
  if (bookingId) form.append("booking_id", bookingId);
  const blob = new Blob([buffer], { type: guessMime(filename) });
  form.append("file", blob, filename);
  const h = headers(false);
  // Let fetch set multipart boundary — do not set Content-Type
  const res = await fetch(url, { method: "POST", headers: h, body: form });
  let data = null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) data = await res.json();
  else data = { detail: await res.text() };
  if (!res.ok) {
    const err = new Error(typeof data?.detail === "string" ? data.detail : data?.detail || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function guessMime(name) {
  const ext = String(name || "").split(".").pop()?.toLowerCase();
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  return "image/jpeg";
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
  rescheduleByPhone: (phone, bookingId, date, startTime) =>
    req("POST", "/internal/whatsapp/bookings/reschedule", {
      phone,
      booking_id: bookingId || null,
      date,
      start_time: startTime,
    }),
  dueReminders: () => req("GET", "/internal/whatsapp/reminders/due"),
  markReminderSent: (bookingId) =>
    req("POST", `/internal/whatsapp/reminders/${bookingId}/sent`, {}),
  siteSettings: () => req("GET", "/site-settings"),
  creditsBalance: (phone) =>
    req("GET", `/credits/balance?phone=${encodeURIComponent(phone)}`),
  uploadComprovante,
};
