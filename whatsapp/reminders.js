/**
 * Periodic ~3h-before reminders. Uses reminder_sent flag in Mongo via API
 * (atomic mark) so restarts never duplicate.
 */
import { api } from "./apiClient.js";
import { formatDateBr } from "./nl.js";

const INTERVAL_MS = Number(process.env.REMINDER_POLL_MS || 60_000);

export function startReminderLoop({ sendText, logger, isConnected }) {
  let running = false;

  async function tick() {
    if (running) return;
    if (!isConnected()) return;
    running = true;
    try {
      const due = await api.dueReminders();
      for (const b of due.bookings || []) {
        try {
          // Atomic claim first: conditional reminder_sent update — only one tick wins a race
          const marked = await api.markReminderSent(b.id);
          if (!marked?.ok) continue; // already claimed/sent by another tick
          const msg =
            `⏰ Lembrete Pedra Azul\n` +
            `Sua reserva é hoje às *${b.start_time}* (${formatDateBr(b.date)}).\n` +
            `🏟 ${b.court_name}\n` +
            `Chegue ~10 min antes. Nos vemos na quadra! ⚽`;
          await sendText(b.whatsapp, msg);
          logger.info({ event: "reminder_send", booking_id: String(b.id).slice(0, 8), date: b.date, time: b.start_time }, "reminder sent");
        } catch (e) {
          logger.warn({ event: "reminder_fail", err: String(e), booking_id: String(b.id).slice(0, 8) }, "reminder failed");
        }
      }
    } catch (e) {
      // API may be down briefly during boot
      logger.debug?.({ err: String(e) }, "reminder poll skip");
    } finally {
      running = false;
    }
  }

  const id = setInterval(tick, INTERVAL_MS);
  // first run after short delay (wait for FastAPI)
  setTimeout(tick, 15_000);
  logger.info({ intervalMs: INTERVAL_MS }, "reminder loop started");
  return () => clearInterval(id);
}
