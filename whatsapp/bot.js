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
const MAPS_URL =
  process.env.COURT_MAPS_URL ||
  "https://www.google.com/maps/search/?api=1&query=Pedra%20Azul%20Nuncio%20Alto%20Tiete%20SP";
const ADMIN_JID = (process.env.WHATSAPP_ADMIN_JID || "").trim();
const COURT_NAME = "Quadra Pedra Azul — Núncio";
const GAME_MINUTES = Number(process.env.COURT_DURATION_MINUTES || 60);

function phoneFromJid(jid) {
  return String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

/** Phone variants for safer match (55 / no-55 / 9th digit). */
export function phoneVariants(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  const set = new Set();
  if (!d) return [];
  set.add(d);
  if (d.startsWith("55") && d.length > 11) set.add(d.slice(2));
  else if (!d.startsWith("55") && d.length >= 10) set.add("55" + d);
  // with/without mobile 9 after DDD (BR)
  for (const v of [...set]) {
    const local = v.startsWith("55") ? v.slice(2) : v;
    if (local.length === 11 && local[2] === "9") {
      const without9 = local.slice(0, 2) + local.slice(3);
      set.add(v.startsWith("55") ? "55" + without9 : without9);
      set.add(without9);
      set.add("55" + without9);
    }
    if (local.length === 10) {
      const with9 = local.slice(0, 2) + "9" + local.slice(2);
      set.add(v.startsWith("55") ? "55" + with9 : with9);
      set.add(with9);
      set.add("55" + with9);
    }
  }
  return [...set];
}

function phonesMatch(a, b) {
  const va = phoneVariants(a);
  const vb = new Set(phoneVariants(b));
  return va.some((x) => vb.has(x));
}

function helpFallback() {
  return (
    `Posso te ajudar com:\n` +
    `• horários (hoje, amanhã, sábado à noite, depois das 20…)\n` +
    `• preço, duração, PIX e estacionamento\n` +
    `• endereço / maps\n` +
    `• reservar (ex.: "quero reservar amanhã às 20h")\n` +
    `• cancelar ou remarcar (só no seu WhatsApp)\n\n` +
    `É só escrever em texto livre 🙂`
  );
}

function greet() {
  return (
    `Olá! Aqui é a *Pedra Azul* ⚽\n` +
    `Quadra única · ${COURT_NAME}.\n\n` +
    `Me diga o que precisa: horários, reservar, preço, PIX, endereço ou cancelar.`
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
      logger.warn({ err: String(e), event: "admin_notify_fail" }, "admin notify failed");
    }
  }

  async function startBookFlow(jid, reply, { date, time, afterHour }) {
    if (!date) {
      await conv.set(jid, "awaiting_slot", { step: "need_date", afterHour: afterHour ?? null });
      await reply(`Qual *data*? Pode ser "hoje", "amanhã", "sábado" ou "15/09".`);
      return;
    }
    if (!time) {
      const data = await api.availability(date, afterHour ?? null);
      const list = formatSlots(data.slots);
      await conv.set(jid, "awaiting_slot", { date, afterHour: afterHour ?? null });
      if (!list) {
        await reply(
          `Sem vagas em *${formatDateBr(date)}*` +
            (afterHour != null ? ` (após ${afterHour}h)` : "") +
            `. Escolha outra data.`
        );
        await conv.clear(jid);
      } else {
        await reply(
          `Ok, *${formatDateBr(date)}*` +
            (afterHour != null ? ` após ${afterHour}h` : "") +
            `. Qual horário?\nLivres: ${list}`
        );
      }
      return;
    }
    await conv.set(jid, "awaiting_name", { date, time });
    await reply(
      `Perfeito: *${formatDateBr(date)}* às *${time}*.\n` +
        `Qual o *seu nome* pra reserva?`
    );
  }

  async function handle(jid, rawText) {
    const text = String(rawText || "").trim();
    if (!text) return;
    const phone = phoneFromJid(jid);
    let session = await conv.get(jid);
    // Idle timeout already cleared in conv.get — note if we just reset
    if (session._idleCleared) {
      logger.info({ event: "conv_idle_clear", jid: phone }, "stale conversation cleared");
    }
    const parsed = detectIntent(text, session);
    logger.info({ event: "bot_intent", jid: phone, intent: parsed.intent, state: session.state }, "bot intent");

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

        case "parking":
          await reply(
            `🅿️ *Estacionamento:* há espaço para carros próximo à quadra (rua / entorno).\n` +
              `Chegue com uns 10 min de antecedência. Se estiver lotado no sábado à noite, oriente o time a combinar caronas.`
          );
          return;

        case "duration":
          await reply(
            `⏱️ Cada reserva é de *${GAME_MINUTES} minutos* (1 hora) na *${COURT_NAME}*.\n` +
              `Valor: *R$ ${PRICE}/hora*. Quer ver horários? Ex.: "sábado à noite" ou "depois das 20".`
          );
          return;

        case "pix_howto":
          await reply(
            `💳 *Como pagar (PIX)*\n` +
              `1) Reserve no *site* (fluxo com CPF) → gera PIX do *calção (30%)*.\n` +
              `2) Pague e *envie o comprovante* (imagem) no site.\n` +
              `3) Status: *aguardando → informado → confirmado* (só o admin confirma).\n` +
              `Pelo WhatsApp a reserva fica confirmada e o pagamento combinamos na hora.\n` +
              `PIX do site expira em ~45 min se não pagar.`
          );
          return;

        case "price":
          await reply(
            `A *${COURT_NAME}* custa *R$ ${PRICE}/hora* (${GAME_MINUTES} min).\n` +
              `No site: calção PIX 30% + comprovante. Pelo WhatsApp combinamos o pagamento na confirmação.`
          );
          return;

        case "address":
          await reply(
            `📍 *Local:* ${LOCATION}\n` +
              `🗺️ Maps (busca): ${MAPS_URL}\n` +
              `(Não inventamos rua completa no cadastro — se precisar do ponto exato, peça aqui.)`
          );
          return;

        case "change_mind": {
          await conv.clear(jid);
          await reply(`Beleza, vamos ajustar 🙂`);
          if (parsed.date || parsed.time || parsed.afterHour != null) {
            await startBookFlow(jid, reply, {
              date: parsed.date,
              time: parsed.time,
              afterHour: parsed.afterHour,
            });
          } else {
            await reply(`Qual *data e horário* prefere agora? Ex.: "amanhã às 20h" ou "sábado depois das 20".`);
          }
          return;
        }

        case "availability": {
          const now = nowSaoPaulo();
          const date = parsed.date || now.ymd;
          const data = await api.availability(date, parsed.afterHour);
          const list = formatSlots(data.slots);
          if (!list) {
            await reply(
              `Não há horários livres em *${formatDateBr(date)}* (${weekdayNamePt(date)}).` +
                (parsed.afterHour != null ? ` (após ${parsed.afterHour}h)` : "") +
                `\nQuer tentar outra data? Ex.: "amanhã" ou "sábado à noite".`
            );
          } else {
            await reply(
              `Horários livres em *${formatDateBr(date)}* (${weekdayNamePt(date)})` +
                (parsed.afterHour != null ? ` após ${parsed.afterHour}h` : "") +
                `:\n${list}\n\n` +
                `Pra reservar: "quero reservar ${formatDateBr(date)} às 20h" (troque o horário).`
            );
          }
          return;
        }

        case "book_start":
        case "book_direct": {
          await startBookFlow(jid, reply, {
            date: parsed.date,
            time: parsed.time,
            afterHour: parsed.afterHour,
          });
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
          await reply(`*${formatDateBr(date)}* às *${time}*. Qual o *seu nome*?`);
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
              `⏰ ${time} · ${GAME_MINUTES} min\n` +
              `🏟 ${COURT_NAME}\n` +
              `💰 R$ ${PRICE}/h\n\n` +
              `Responda *sim* ou *não*. (Se mudou de ideia, diga a nova data/hora.)`
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
              logger.info(
                { event: "booking_create", source: "whatsapp", booking_id: booking.id?.slice(0, 8), date, time },
                "booking created"
              );
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
                logger.info(
                  {
                    event: "booking_cancel",
                    source: "whatsapp",
                    booking_id: result.id?.slice?.(0, 8) || result.id,
                    date: result.date,
                    time: result.start_time,
                  },
                  "booking cancelled"
                );
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
          if (session.state === "awaiting_reschedule_confirm") {
            // Cancel old, then ask for new slot
            try {
              const result = await api.cancelByPhone(phone, session.data?.booking_id || null);
              if (!result.cancelled) {
                await conv.clear(jid);
                await reply(result.message || `Não consegui liberar a reserva antiga.`);
                return;
              }
              logger.info(
                { event: "booking_reschedule_cancel", source: "whatsapp", booking_id: result.id?.slice?.(0, 8) },
                "reschedule: old cancelled"
              );
              await conv.clear(jid);
              await reply(
                `Liberamos *${formatDateBr(result.date)}* às *${result.start_time}*.\n` +
                  `Qual a *nova data e horário*? Ex.: "amanhã às 21h" ou "sábado depois das 20".`
              );
            } catch (e) {
              await conv.clear(jid);
              await reply(`Falha ao remarcar: ${e.message}`);
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
          const active = (list.bookings || []).filter(
            (b) =>
              ["pending", "awaiting_admin", "confirmed"].includes(b.status) &&
              phonesMatch(phone, b.whatsapp)
          );
          if (!active.length) {
            await reply(`Não encontrei reserva ativa neste WhatsApp. Só cancelamos se o número bater com a reserva.`);
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
          // Prefer matching date/time from message if present
          const wantDate = parseDate(text);
          const wantTime = parseTime(text);
          let chosen = active[0];
          if (wantDate || wantTime) {
            const hit = active.find(
              (b) => (!wantDate || b.date === wantDate) && (!wantTime || b.start_time === wantTime)
            );
            if (hit) chosen = hit;
          }
          await conv.set(jid, "awaiting_cancel_confirm", {
            booking_id: chosen.id,
            options: active.map((b) => b.id),
          });
          await reply(
            `Você tem mais de uma reserva:\n${lines}\n\n` +
              `Vou sugerir cancelar *${formatDateBr(chosen.date)} ${chosen.start_time}*. Confirma com *sim*? (Ou diga a data/hora exata.)`
          );
          return;
        }

        case "reschedule": {
          const list = await api.listByPhone(phone);
          const active = (list.bookings || []).filter(
            (b) =>
              ["pending", "awaiting_admin", "confirmed"].includes(b.status) &&
              phonesMatch(phone, b.whatsapp)
          );
          if (!active.length) {
            await reply(`Não achei reserva ativa neste WhatsApp pra remarcar. Quer fazer uma nova?`);
            return;
          }
          const b = active[0];
          await conv.set(jid, "awaiting_reschedule_confirm", { booking_id: b.id });
          await reply(
            `Remarcar *${formatDateBr(b.date)}* às *${b.start_time}*?\n` +
              `Vou *cancelar* essa e em seguida você escolhe o novo horário.\n` +
              `Responda *sim* ou *não*.`
          );
          return;
        }

        case "unknown":
        default: {
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
      logger.error({ err: String(e), event: "bot_error" }, "bot handle error");
      await reply(`Tive um problema técnico agora. Tente de novo em instantes.`);
    }
  }

  return { handle, phoneFromJid, phoneVariants, phonesMatch, notifyAdmin };
}
