/**
 * Natural-language WhatsApp bot for Pedra Azul (single court).
 * Short pt-BR replies; numeric menus only as fallback.
 */
import { api } from "./apiClient.js";
import {
  detectIntent,
  formatDateBr,
  nowSaoPaulo,
  parseDate,
  parseTime,
  weekdayNamePt,
} from "./nl.js";

const PRICE = Number(process.env.COURT_PRICE_PER_HOUR || 130);
const LOCATION =
  process.env.COURT_LOCATION ||
  "Quadra Pedra Azul — Núncio · Alto Tietê · SP";
const ADMIN_JID = (process.env.WHATSAPP_ADMIN_JID || "").trim();
const COURT_NAME = "Quadra Pedra Azul — Núncio";

function phoneFromJid(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function helpFallback() {
  return (
    `Posso te ajudar com:\n` +
    `• horários (hoje, amanhã, sábado…)\n` +
    `• preço e endereço\n` +
    `• reservar (ex.: "quero reservar amanhã às 20h")\n` +
    `• cancelar reserva\n\n` +
    `É só escrever em texto livre 🙂`
  );
}

function greet() {
  return (
    `Olá! Aqui é a *Pedra Azul* ⚽\n` +
    `Quadra única · ${COURT_NAME}.\n\n` +
    `Me diga o que precisa: horários, reservar, preço, endereço ou cancelar.`
  );
}

function formatSlots(slots) {
  const free = (slots || []).filter((s) => s.status === "available");
  if (!free.length) return null;
  return free.map((s) => s.time).join(", ");
}

/**
 * @param {{ sendText: Function, sendToJid: Function, conv: any, logger: any }} deps
 */
export function createBot(deps) {
  const { sendText, sendToJid, conv, logger } = deps;

  async function notifyAdmin(text) {
    if (!ADMIN_JID) return;
    try {
      await sendToJid(ADMIN_JID, text);
    } catch (e) {
      logger.warn({ err: String(e) }, "admin notify failed");
    }
  }

  async function handle(jid, rawText) {
    const text = String(rawText || "").trim();
    if (!text) return;
    const phone = phoneFromJid(jid);
    let session = await conv.get(jid);
    const parsed = detectIntent(text, session);
    logger.info({ jid: phone, intent: parsed.intent, state: session.state }, "bot intent");

    const reply = async (msg) => {
      await sendToJid(jid, msg);
    };

    try {
      switch (parsed.intent) {
        case "greeting":
          await conv.clear(jid);
          await reply(greet());
          return;

        case "help":
          await reply(helpFallback());
          return;

        case "price":
          await reply(
            `A *${COURT_NAME}* custa *R$ ${PRICE}/hora*.\n` +
              `Sinal (PIX) no site: 30%. Pelo WhatsApp combinamos o pagamento na confirmação.`
          );
          return;

        case "address":
          await reply(
            `📍 *Local:* ${LOCATION}\n` +
              `(Endereço completo de rua não está no cadastro do site — se precisar do ponto exato, fale com a gente aqui.)`
          );
          return;

        case "availability": {
          const now = nowSaoPaulo();
          const date = parsed.date || now.ymd;
          const data = await api.availability(date, parsed.afterHour);
          const list = formatSlots(data.slots);
          if (!list) {
            await reply(
              `Não há horários livres em *${formatDateBr(date)}* (${weekdayNamePt(date)}).` +
                (parsed.afterHour != null ? ` (após ${parsed.afterHour}h)` : "") +
                `\nQuer tentar outra data? Ex.: "amanhã" ou "sábado".`
            );
          } else {
            await reply(
              `Horários livres em *${formatDateBr(date)}* (${weekdayNamePt(date)}):\n` +
                `${list}\n\n` +
                `Pra reservar: "quero reservar ${formatDateBr(date)} às 20h" (troque o horário).`
            );
          }
          return;
        }

        case "book_start":
        case "book_direct": {
          let date = parsed.date;
          let time = parsed.time;
          if (!date) {
            await conv.set(jid, "awaiting_slot", { ...session.data, step: "need_date" });
            await reply(`Qual *data*? Pode ser "hoje", "amanhã", "sábado" ou "15/09".`);
            return;
          }
          if (!time) {
            const data = await api.availability(date, parsed.afterHour);
            const list = formatSlots(data.slots);
            await conv.set(jid, "awaiting_slot", { date, afterHour: parsed.afterHour });
            if (!list) {
              await reply(`Sem vagas em *${formatDateBr(date)}*. Escolha outra data.`);
              await conv.clear(jid);
            } else {
              await reply(
                `Ok, *${formatDateBr(date)}*. Qual horário?\nLivres: ${list}`
              );
            }
            return;
          }
          // have date + time → ask name
          await conv.set(jid, "awaiting_name", { date, time });
          await reply(
            `Perfeito: *${formatDateBr(date)}* às *${time}*.\n` +
              `Qual o *seu nome* pra reserva?`
          );
          return;
        }

        case "provide_slot": {
          const date = session.data?.date;
          if (!date) {
            await conv.clear(jid);
            await reply(`Vamos recomeçar. Qual data e horário? Ex.: "amanhã às 20h".`);
            return;
          }
          if (session.data?.step === "need_date") {
            const d = parseDate(text) || date;
            await conv.set(jid, "awaiting_slot", { date: d });
            const data = await api.availability(d, null);
            const list = formatSlots(data.slots);
            if (!list) {
              await reply(`Sem vagas em *${formatDateBr(d)}*. Outra data?`);
              await conv.clear(jid);
            } else {
              await reply(`Horários livres em *${formatDateBr(d)}*: ${list}\nQual horário?`);
            }
            return;
          }
          const time = parsed.time || parseTime(text);
          if (!time) {
            await reply(`Não entendi o horário. Ex.: 20, 20h, 20:00 ou "8 da noite".`);
            return;
          }
          await conv.set(jid, "awaiting_name", { date, time });
          await reply(
            `*${formatDateBr(date)}* às *${time}*. Qual o *seu nome*?`
          );
          return;
        }

        case "provide_name": {
          const name = (parsed.name || text).trim().slice(0, 80);
          if (name.length < 2) {
            await reply(`Me diga um nome válido 🙂`);
            return;
          }
          const { date, time } = session.data || {};
          if (!date || !time) {
            await conv.clear(jid);
            await reply(`Perdi o contexto. Digite de novo: "reservar amanhã às 20h".`);
            return;
          }
          await conv.set(jid, "awaiting_confirm", { date, time, name });
          await reply(
            `Confirma a reserva?\n` +
              `👤 ${name}\n` +
              `📅 ${formatDateBr(date)} (${weekdayNamePt(date)})\n` +
              `⏰ ${time}\n` +
              `🏟 ${COURT_NAME}\n` +
              `💰 R$ ${PRICE}/h\n\n` +
              `Responda *sim* ou *não*.`
          );
          return;
        }

        case "affirm": {
          if (session.state === "awaiting_confirm") {
            const { date, time, name } = session.data || {};
            try {
              const booking = await api.createBooking({
                phone,
                customer_name: name,
                date,
                start_time: time,
              });
              await conv.clear(jid);
              await reply(
                `✅ *Reserva confirmada!*\n` +
                  `👤 ${booking.customer_name}\n` +
                  `📅 ${formatDateBr(booking.date)} às ${booking.start_time}\n` +
                  `🏟 ${booking.court_name}\n` +
                  `Protocolo: ${booking.id.slice(0, 8)}\n\n` +
                  `Te mando um lembrete ~3h antes. Boa partida! ⚽`
              );
              await notifyAdmin(
                `🆕 Reserva WhatsApp\n${name}\n${formatDateBr(date)} ${time}\nTel: +${phone}\nID: ${booking.id.slice(0, 8)}`
              );
            } catch (e) {
              await conv.clear(jid);
              if (e.status === 409) {
                await reply(`Esse horário acabou de ser preenchido 😕. Quer ver outros horários?`);
              } else {
                await reply(`Não consegui gravar a reserva: ${e.message}. Tente de novo ou use o site.`);
              }
            }
            return;
          }
          if (session.state === "awaiting_cancel_confirm") {
            try {
              const result = await api.cancelByPhone(phone, session.data?.booking_id || null);
              await conv.clear(jid);
              if (result.cancelled) {
                await reply(
                  `Reserva cancelada: ${formatDateBr(result.date)} às ${result.start_time}. Se precisar, é só chamar.`
                );
                await notifyAdmin(
                  `❌ Cancelamento WA +${phone}\n${formatDateBr(result.date)} ${result.start_time}`
                );
              } else {
                await reply(result.message || `Não achei reserva ativa neste número.`);
              }
            } catch (e) {
              await conv.clear(jid);
              await reply(`Falha ao cancelar: ${e.message}`);
            }
            return;
          }
          await reply(helpFallback());
          return;
        }

        case "deny": {
          await conv.clear(jid);
          await reply(`Tudo bem, cancelei essa etapa. Se quiser reservar depois, é só falar.`);
          return;
        }

        case "cancel": {
          const list = await api.listByPhone(phone);
          const active = (list.bookings || []).filter((b) =>
            ["pending", "awaiting_admin", "confirmed"].includes(b.status)
          );
          if (!active.length) {
            await reply(`Não encontrei reserva ativa neste WhatsApp.`);
            return;
          }
          if (active.length === 1) {
            const b = active[0];
            await conv.set(jid, "awaiting_cancel_confirm", { booking_id: b.id });
            await reply(
              `Cancelar *${formatDateBr(b.date)}* às *${b.start_time}* (${b.customer_name})?\n` +
                `Responda *sim* ou *não*.`
            );
            return;
          }
          const lines = active
            .slice(0, 5)
            .map((b, i) => `${i + 1}) ${formatDateBr(b.date)} ${b.start_time}`)
            .join("\n");
          await conv.set(jid, "awaiting_cancel_confirm", {
            booking_id: active[0].id,
            options: active.map((b) => b.id),
          });
          await reply(
            `Você tem mais de uma reserva:\n${lines}\n\n` +
              `Vou sugerir cancelar a primeira. Confirma com *sim*? (Ou diga a data/hora exata.)`
          );
          return;
        }

        case "unknown":
        default: {
          // Salvage date/time phrasing without recursion loops
          const d = parseDate(text);
          const tm = parseTime(text);
          if (d && tm) {
            await conv.set(jid, "awaiting_name", { date: d, time: tm });
            await reply(
              `Entendi *${formatDateBr(d)}* às *${tm}*. Qual o *seu nome* pra reserva?`
            );
            return;
          }
          if (d) {
            const data = await api.availability(d, null);
            const list = formatSlots(data.slots);
            await conv.set(jid, "awaiting_slot", { date: d });
            await reply(
              list
                ? `Horários em *${formatDateBr(d)}*: ${list}\nQual horário?`
                : `Sem vagas em *${formatDateBr(d)}*. Outra data?`
            );
            return;
          }
          await reply(`Não entendi bem 😅\n\n${helpFallback()}`);
          return;
        }
      }
    } catch (e) {
      logger.error({ err: String(e) }, "bot handle error");
      await reply(`Tive um problema técnico agora. Tente de novo em instantes.`);
    }
  }

  return { handle, phoneFromJid, notifyAdmin };
}
