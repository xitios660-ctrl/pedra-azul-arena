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

const ADMIN_JID = (process.env.WHATSAPP_ADMIN_JID || "").trim();

const FALLBACK_SETTINGS = {
  price_per_hour: Number(process.env.COURT_PRICE_PER_HOUR || 130),
  address_label:
    process.env.COURT_LOCATION ||
    "Núncio · Alto Tietê · SP",
  maps_url:
    process.env.COURT_MAPS_URL ||
    "https://www.google.com/maps/search/?api=1&query=Pedra%20Azul%20Nuncio%20Alto%20Tiete%20SP",
  court_name: "Quadra Pedra Azul — Núncio",
  slot_duration_minutes: Number(process.env.COURT_DURATION_MINUTES || 60),
  pix_key: process.env.PIX_KEY || "contato@pedraazulfs.com.br",
  pix_copy_text: process.env.PIX_COPY_TEXT || "",
  parking_note: "Estacionamento no entorno da quadra — chegue ~10 min antes.",
  has_parking: true,
  game_duration_note: "1 hora (60 min)",
  accepts_pix: true,
  structure_blurb:
    "Quadra oficial no Alto Tietê — iluminação noturna, espaço para peladas e treinos. Chegue ~10 min antes.",
  amenities: ["Iluminação noturna", "Pelada & treino", "Copa Alto Tietê"],
  open_hour: 8,
  close_hour: 23,
  weekend_open_hour: null,
  weekend_close_hour: null,
};

let _settingsCache = { at: 0, data: null };
async function getSiteSettings() {
  const now = Date.now();
  if (_settingsCache.data && now - _settingsCache.at < 60_000) return _settingsCache.data;
  try {
    const data = await api.siteSettings();
    _settingsCache = { at: now, data: { ...FALLBACK_SETTINGS, ...data } };
    return _settingsCache.data;
  } catch (_) {
    return _settingsCache.data || FALLBACK_SETTINGS;
  }
}

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
    `• cancelar ou remarcar (só no seu WhatsApp)\n` +
    `• enviar *foto do comprovante PIX* (admin valida — nunca confirma sozinho)\n\n` +
    `É só escrever em texto livre 🙂`
  );
}

function greet() {
  return (
    `Olá! Aqui é a *Pedra Azul* ⚽\n` +
    `Quadra única · Pedra Azul — Núncio.\n\n` +
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
    const site = await getSiteSettings();
    const PRICE = site.price_per_hour;
    const COURT_NAME = site.court_name;
    const GAME_MINUTES = site.slot_duration_minutes || 60;

    try {
      switch (parsed.intent) {
        case "greeting":
          await conv.clear(jid);
          await reply(greet());
          return;

        case "help":
          await reply(helpFallback());
          return;

        case "parking": {
          const s = await getSiteSettings();
          if (s.has_parking === false) {
            await reply(
              `🅿️ *Estacionamento:* não temos vaga própria no local.\n` +
                `${s.parking_note ? s.parking_note + "\n" : ""}` +
                `Se vier de carro, combine carona com o time.`
            );
          } else {
            await reply(
              `🅿️ *Estacionamento:* ${s.parking_note || "há espaço para carros no entorno da quadra."}\n` +
                `Chegue uns 10 min antes — sábado à noite costuma lotar; carona ajuda.`
            );
          }
          return;
        }

        case "duration": {
          const s = await getSiteSettings();
          const mins = s.slot_duration_minutes || 60;
          const note = (s.game_duration_note || "").trim() || `${mins} minutos`;
          const wo = s.weekend_open_hour;
          const wc = s.weekend_close_hour;
          const hasWe =
            wo !== null && wo !== undefined && Number(wo) !== -1 &&
            wc !== null && wc !== undefined && Number(wc) !== -1;
          let hoursLine = `${String(s.open_hour).padStart(2, "0")}h–${String(s.close_hour).padStart(2, "0")}h`;
          if (hasWe) {
            hoursLine += ` (sáb/dom ${String(wo).padStart(2, "0")}h–${String(wc).padStart(2, "0")}h)`;
          }
          await reply(
            `⏱️ Cada jogo/reserva dura *${note}* na *${s.court_name}*.\n` +
              `Valor: *R$ ${s.price_per_hour}/hora*. Horário: ${hoursLine}. Quer ver vagas? Ex.: "sábado à noite".`
          );
          return;
        }

        case "pix_howto": {
          const s = await getSiteSettings();
          if (s.accepts_pix === false) {
            await reply(
              `💳 No momento *não estamos aceitando PIX* pela configuração da quadra.\n` +
                `Fale com a gente para combinar outra forma de pagamento ou aguarde atualização.`
            );
            return;
          }
          const keyLine = s.pix_key ? `Chave PIX: *${s.pix_key}*\n` : "";
          await reply(
            `💳 *Sim, aceitamos PIX.*\n` +
              keyLine +
              `1) Reserve no *site* (fluxo com CPF) → gera PIX do *calção (30%)*.\n` +
              `2) Pague e *envie a foto do comprovante* no site *ou aqui no WhatsApp*.\n` +
              `3) Status: *aguardando → informado → confirmado* (só o admin confirma — nunca automático).\n` +
              `Pelo WhatsApp você também pode reservar; se já tiver PIX pendente, mande a *imagem* do comprovante.\n` +
              `PIX do site expira em ~45 min se não pagar.`
          );
          return;
        }

        case "price": {
          const s = await getSiteSettings();
          const note = (s.game_duration_note || "").trim() || `${s.slot_duration_minutes || 60} min`;
          const pixBit =
            s.accepts_pix === false
              ? "PIX desativado nas configurações — combine o pagamento no WhatsApp."
              : "No site: calção PIX 30% + comprovante. Pelo WhatsApp combinamos o pagamento na confirmação.";
          await reply(
            `A *${s.court_name}* custa *R$ ${s.price_per_hour}/hora* (${note}).\n` + pixBit
          );
          return;
        }

        case "address": {
          const s = await getSiteSettings();
          const blurb = (s.structure_blurb || "").trim();
          await reply(
            `📍 *Local:* ${s.address_label}\n` +
              `🗺️ Maps (busca): ${s.maps_url}\n` +
              (blurb ? `${blurb}\n` : "") +
              `(Sem número de rua inventado no cadastro — se precisar do ponto exato, peça aqui.)`
          );
          return;
        }

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
          if (session.state === "awaiting_reschedule_slot") {
            const date = parseDate(text) || session.data?.date || null;
            const time = parsed.time || parseTime(text);
            if (!date) {
              await reply(`Qual a *nova data*? Ex.: amanhã, sábado ou 20/09.`);
              return;
            }
            if (!time) {
              await conv.set(jid, "awaiting_reschedule_slot", {
                booking_id: session.data?.booking_id || null,
                date,
              });
              const data = await api.availability(date, null);
              const list = formatSlots(data.slots);
              if (!list) {
                await reply(`Sem vagas em *${formatDateBr(date)}*. Outra data?`);
              } else {
                await reply(`Horários livres em *${formatDateBr(date)}*: ${list}\nQual horário?`);
              }
              return;
            }
            try {
              const result = await api.rescheduleByPhone(
                phone,
                session.data?.booking_id || null,
                date,
                time
              );
              if (!result.ok) {
                await reply(result.message || `Não consegui remarcar esse horário.`);
                return;
              }
              logger.info(
                {
                  event: "booking_reschedule",
                  source: "whatsapp",
                  booking_id: result.id?.slice?.(0, 8),
                  date: result.date,
                  time: result.start_time,
                },
                "booking rescheduled"
              );
              await conv.clear(jid);
              await reply(
                `Pronto! Remarcamos de *${formatDateBr(result.previous_date)} ${result.previous_start_time}* ` +
                  `para *${formatDateBr(result.date)}* às *${result.start_time}*.\n` +
                  `Status/pagamento anterior mantido.`
              );
              await notifyAdmin(
                `🔁 Remarcação WA +${phone}\n` +
                  `${formatDateBr(result.previous_date)} ${result.previous_start_time} → ` +
                  `${formatDateBr(result.date)} ${result.start_time}`
              );
            } catch (e) {
              const detail = typeof e.data?.detail === "string" ? e.data.detail : e.message;
              await reply(`Falha ao remarcar: ${detail}`);
            }
            return;
          }
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
            // Keep old booking until new slot is chosen (atomic API preserves payment)
            await conv.set(jid, "awaiting_reschedule_slot", {
              booking_id: session.data?.booking_id || null,
            });
            await reply(
              `Beleza — qual a *nova data e horário*?\n` +
                `Ex.: "amanhã às 21h" ou "sábado 20h". A reserva atual só muda se o novo horário estiver livre.`
            );
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
            `Remarcar *${formatDateBr(b.date)}* às *${b.start_time}* (${b.customer_name})?\n` +
              `O pagamento/status atual é mantido — só trocamos data/hora.\n` +
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


  /**
   * Inbound image = possible PIX comprovante.
   * Attaches to pending/awaiting booking for this phone → status informado (awaiting_admin).
   * NEVER auto-confirms.
   */
  async function handleImage(jid, buffer, meta = {}) {
    const phone = phoneFromJid(jid);
    const reply = async (msg) => {
      await sendToJid(jid, msg);
    };
    const filename = meta.filename || "comprovante.jpg";
    const caption = String(meta.caption || "").trim();
    logger.info(
      { event: "wa_image_in", jid: phone, bytes: buffer?.length || 0, filename },
      "inbound image"
    );
    if (!buffer || !buffer.length) {
      await reply(`Recebi a imagem, mas ela veio vazia. Pode reenviar o comprovante?`);
      return;
    }
    try {
      const result = await api.uploadComprovante(phone, buffer, filename);
      const b = result.booking || {};
      logger.info(
        {
          event: "comprovante_wa",
          booking_id: b.id?.slice?.(0, 8),
          status: result.status || b.status,
          auto_confirmed: false,
        },
        "comprovante attached — awaiting admin"
      );
      await reply(
        `🧾 *Comprovante recebido!*\n` +
          `Reserva: *${b.date || "—"}* às *${b.start_time || "—"}*\n` +
          `Status: *informado* (aguardando o admin validar o PIX).\n\n` +
          `⚠️ A confirmação *não é automática* — o admin vai revisar e te avisa.`
      );
      await notifyAdmin(
        `🧾 Comprovante WhatsApp (informado)\n` +
          `${b.customer_name || "Cliente"} · ${b.date || ""} ${b.start_time || ""}\n` +
          `Tel: +${phone}\n` +
          `ID: ${(b.id || "").slice(0, 8)}\n` +
          `Link: ${b.payment?.comprovante_url || "(anexado)"}\n` +
          `⚠️ Validar no Admin — NÃO auto-confirmado`
      );
      if (caption) {
        logger.info({ event: "comprovante_caption", caption: caption.slice(0, 80) }, "caption ignored for confirm");
      }
    } catch (e) {
      if (e.status === 404) {
        await reply(
          `Recebi sua imagem, mas *não achei reserva pendente* neste WhatsApp.\n` +
            `Faça a reserva no *site* (PIX), depois reenvie o comprovante aqui ou pelo site.\n` +
            `Lembre: só o admin confirma o pagamento.`
        );
      } else {
        logger.warn({ err: String(e), event: "comprovante_wa_fail" }, "comprovante upload failed");
        await reply(`Não consegui gravar o comprovante agora (${e.message}). Tente de novo ou use o site.`);
      }
    }
  }

  return { handle, handleImage, phoneFromJid, phoneVariants, phonesMatch, notifyAdmin };
}
