import React, { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  HelpCircle,
  MessageCircle,
  CalendarDays,
  MapPin,
  Clock,
  Banknote,
  Car,
  CloudRain,
  ScrollText,
  Phone,
} from "lucide-react";
import PageShell from "@/components/PageShell";
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import { useSiteSettings } from "@/lib/SiteSettings";
import {
  priceLabel,
  gameDurationLabel,
  mapsUrlReady,
  resolvePolicyCancel,
  resolvePolicyRain,
  whatsappUrl,
  defaultWhatsAppPrefill,
  OPEN_DAY_LABELS,
  COURT_LOCATION,
} from "@/lib/siteConfig";
import { FAQ } from "@/constants/testIds";

function padHour(h) {
  const n = Number(h);
  if (!Number.isFinite(n)) return "--:00";
  return `${String(n).padStart(2, "0")}:00`;
}

function fmtMoney(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v % 1 === 0 ? String(v) : v.toFixed(2);
}

/** Build FAQ Q&As from live site_settings — omit empty / disabled sections. */
export function buildFaqItems(settings, { waReady = false, pixReady = false } = {}) {
  const s = settings || {};
  const items = [];

  const weekOpen = padHour(s.open_hour ?? 8);
  const weekClose = padHour(s.close_hour ?? 23);
  const wo = s.weekend_open_hour;
  const wc = s.weekend_close_hour;
  const hasWeekend =
    wo !== null &&
    wo !== undefined &&
    wo !== "" &&
    Number(wo) !== -1 &&
    wc !== null &&
    wc !== undefined &&
    wc !== "" &&
    Number(wc) !== -1;

  const days = Array.isArray(s.open_days) ? s.open_days.map(Number).filter((d) => d >= 0 && d <= 6) : [0, 1, 2, 3, 4, 5, 6];
  const daysLabel =
    days.length === 7
      ? "Todos os dias"
      : days.length === 0
        ? "Fechada todos os dias (consulte o WhatsApp)"
        : days.map((d) => OPEN_DAY_LABELS.find((x) => x.value === d)?.full || String(d)).join(", ");

  let hoursAnswer = `Horário de funcionamento (${daysLabel}):\n• Segunda a sexta: ${weekOpen} – ${weekClose}`;
  if (hasWeekend) {
    hoursAnswer += `\n• Sábado e domingo: ${padHour(wo)} – ${padHour(wc)}`;
  } else {
    hoursAnswer += `\n• Sábado e domingo: ${weekOpen} – ${weekClose}`;
  }
  items.push({
    id: "hours",
    question: "Qual o horário de funcionamento?",
    answer: hoursAnswer,
  });

  const basePrice = Number(s.price_per_hour);
  const wePrice =
    s.price_weekend != null && s.price_weekend !== "" && Number(s.price_weekend) > 0
      ? Number(s.price_weekend)
      : null;
  let priceAnswer = `O valor da hora é ${priceLabel(Number.isFinite(basePrice) ? basePrice : 130)}.`;
  if (wePrice != null) {
    priceAnswer += ` No fim de semana (sáb/dom): R$ ${fmtMoney(wePrice)}/h.`;
  }
  const duration = gameDurationLabel(s);
  if (duration) {
    priceAnswer += ` Duração padrão do jogo: ${duration}.`;
  }
  items.push({
    id: "price",
    question: "Quanto custa reservar a quadra?",
    answer: priceAnswer,
  });

  if (s.accepts_pix === false) {
    items.push({
      id: "pix",
      question: "Aceitam PIX?",
      answer:
        "No momento o PIX não está habilitado nas configurações da quadra. Combine o pagamento pelo WhatsApp ou reserve e siga as instruções no site.",
    });
  } else {
    let pixAnswer =
      "Sim, aceitamos PIX. No site, a reserva gera o PIX do sinal (30% — calção). Pague e envie o comprovante no site ou pelo WhatsApp. A confirmação é feita pela arena (não é automática).";
    if (pixReady && s.pix_key) {
      pixAnswer += ` Chave PIX: ${String(s.pix_key).trim()}.`;
    }
    items.push({
      id: "pix",
      question: "Aceitam PIX? Como funciona o pagamento?",
      answer: pixAnswer,
    });
  }

  const policiesOn = s.policies_enabled !== false;
  const cancelTxt = policiesOn ? resolvePolicyCancel(s) : "";
  if (cancelTxt) {
    items.push({
      id: "cancel",
      question: "Qual a política de cancelamento?",
      answer: cancelTxt,
    });
  }

  const rainTxt = policiesOn ? resolvePolicyRain(s) : "";
  if (rainTxt) {
    items.push({
      id: "rain",
      question: "O que acontece em caso de chuva?",
      answer: rainTxt,
    });
  }

  const parkingNote = String(s.parking_note || "").trim();
  if (s.has_parking === false) {
    items.push({
      id: "parking",
      question: "Tem estacionamento?",
      answer: parkingNote
        ? parkingNote
        : "Não temos vaga própria no local. Se vier de carro, combine carona com o time.",
    });
  } else if (parkingNote) {
    items.push({
      id: "parking",
      question: "Tem estacionamento?",
      answer: parkingNote,
    });
  }

  if (duration) {
    items.push({
      id: "duration",
      question: "Quanto tempo dura cada jogo / reserva?",
      answer: `Cada reserva dura ${duration}${
        s.allow_multi_hour !== false && Number(s.max_hours_per_booking || 2) > 1
          ? `. No site é possível reservar até ${Number(s.max_hours_per_booking || 2)} horas consecutivas quando o próximo horário estiver livre.`
          : "."
      }`,
    });
  }

  if (waReady) {
    const display = String(s.whatsapp_display || "").trim();
    items.push({
      id: "whatsapp",
      question: "Como falo pelo WhatsApp?",
      answer: display
        ? `Fale conosco no WhatsApp ${display}. Use o botão nesta página ou no site para abrir a conversa com a mensagem pronta.`
        : "Fale conosco pelo WhatsApp usando o botão nesta página ou no site.",
    });
  }

  const address = String(s.address_label || COURT_LOCATION).trim();
  if (address) {
    let addrAnswer = `Local: ${address}.`;
    if (mapsUrlReady(s)) {
      addrAnswer += " Use o link “Como chegar” abaixo para abrir o mapa.";
    }
    items.push({
      id: "address",
      question: "Onde fica a quadra?",
      answer: addrAnswer,
    });
  }

  return items.filter((it) => it.question && String(it.answer || "").trim());
}

const FAQ_TITLE = "Perguntas frequentes · Pedra Azul Arena";
const FAQ_DESC =
  "Horários, preços, PIX, cancelamento, chuva, estacionamento e endereço da Quadra Pedra Azul em Núncio (Alto Tietê). Reserve online.";

export default function Faq() {
  const { settings, waReady, waHref: ctxWa, pixReady, loading } = useSiteSettings();
  const waHref = waReady
    ? ctxWa || whatsappUrl(defaultWhatsAppPrefill(), settings.whatsapp_e164)
    : null;

  const items = useMemo(
    () => buildFaqItems(settings, { waReady, pixReady }),
    [settings, waReady, pixReady]
  );

  useEffect(() => {
    const prevTitle = document.title;
    document.title = FAQ_TITLE;
    let meta = document.querySelector('meta[name="description"]');
    const created = !meta;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "description");
      document.head.appendChild(meta);
    }
    const prevDesc = meta.getAttribute("content");
    meta.setAttribute("content", FAQ_DESC);

    return () => {
      document.title = prevTitle;
      if (created) {
        meta.remove();
      } else if (prevDesc != null) {
        meta.setAttribute("content", prevDesc);
      }
    };
  }, []);

  useEffect(() => {
    const id = "faq-jsonld";
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    if (!items.length) return undefined;

    const schema = {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: items.map((it) => ({
        "@type": "Question",
        name: it.question,
        acceptedAnswer: {
          "@type": "Answer",
          text: String(it.answer).trim(),
        },
      })),
    };
    const script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    script.text = JSON.stringify(schema);
    document.head.appendChild(script);
    return () => {
      const el = document.getElementById(id);
      if (el) el.remove();
    };
  }, [items]);

  const mapsOk = mapsUrlReady(settings);
  const address = String(settings.address_label || COURT_LOCATION).trim();

  const iconFor = (id) => {
    switch (id) {
      case "hours":
        return <Clock className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />;
      case "price":
      case "pix":
        return <Banknote className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />;
      case "cancel":
        return <ScrollText className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />;
      case "rain":
        return <CloudRain className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />;
      case "parking":
        return <Car className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />;
      case "duration":
        return <Clock className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />;
      case "whatsapp":
        return <Phone className="w-4 h-4 text-[#25D366] shrink-0" aria-hidden />;
      case "address":
        return <MapPin className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />;
      default:
        return <HelpCircle className="w-4 h-4 text-[var(--brand)] shrink-0" aria-hidden />;
    }
  };

  return (
    <PageShell>
      <div data-testid={FAQ.page} className="max-w-3xl mx-auto px-4 sm:px-6 md:px-10 py-10 md:py-14">
        <div className="diagonal-stripe pb-6 mb-8 md:mb-10">
          <div className="text-[11px] tracking-[0.35em] uppercase text-[var(--brand)] mb-2 flex items-center gap-2">
            <HelpCircle className="w-3.5 h-3.5" aria-hidden />
            // FAQ · Perguntas frequentes
          </div>
          <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl uppercase italic leading-[0.92]">
            Dúvidas <span className="text-[var(--brand)] text-glow-strong">frequentes</span>
          </h1>
          <p className="text-white/60 mt-3 text-sm sm:text-base max-w-xl">
            Respostas com base nas configurações ao vivo da arena — horários, preço, PIX, políticas e local.
            {loading ? " Carregando dados…" : null}
          </p>
        </div>

        {items.length === 0 ? (
          <div
            className="glass border border-white/10 rounded-lg p-6 text-center text-white/55 text-sm"
            data-testid={FAQ.empty}
          >
            Nenhuma pergunta disponível no momento.
          </div>
        ) : (
          <Accordion
            type="multiple"
            defaultValue={items.slice(0, 2).map((i) => i.id)}
            className="space-y-2"
            data-testid={FAQ.accordion}
          >
            {items.map((it) => (
              <AccordionItem
                key={it.id}
                value={it.id}
                data-testid={`${FAQ.itemPrefix}${it.id}`}
                className="glass border border-white/10 rounded-lg px-4 border-b-0 data-[state=open]:border-[var(--brand)]/40 data-[state=open]:shadow-[0_0_24px_rgba(0,229,255,0.12)]"
              >
                <AccordionTrigger
                  className="min-h-[48px] py-3 text-sm sm:text-[15px] font-display tracking-wide text-white/90 hover:no-underline hover:text-white [&[data-state=open]]:text-[var(--brand)]"
                >
                  <span className="inline-flex items-center gap-2.5 text-left pr-2">
                    {iconFor(it.id)}
                    {it.question}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="text-sm text-white/65 leading-relaxed whitespace-pre-wrap pb-4">
                  {it.answer}
                  {it.id === "address" && mapsOk && (
                    <a
                      href={String(settings.maps_url).trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={FAQ.mapsLink}
                      className="mt-3 inline-flex items-center gap-1.5 text-[var(--brand)] hover:underline min-h-[44px]"
                    >
                      <MapPin className="w-3.5 h-3.5" aria-hidden />
                      Como chegar{address ? ` · ${address}` : ""}
                    </a>
                  )}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        )}

        <div
          className="mt-10 glass p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-[var(--brand)]/25"
          data-testid={FAQ.ctaBand}
        >
          <div>
            <div className="text-[10px] tracking-[0.35em] uppercase text-[var(--brand)] mb-1">
              // Pronto para jogar
            </div>
            <p className="text-white/80 text-sm sm:text-base">
              Reserve online sem cadastro (CPF + PIX)
              {waReady ? " ou fale no WhatsApp." : "."}
            </p>
          </div>
          <div className="flex flex-col xs:flex-row gap-2 sm:gap-3 shrink-0">
            <Link
              to="/booking"
              data-testid={FAQ.ctaBook}
              className="btn-neon inline-flex items-center justify-center gap-2 min-h-[48px] px-5"
            >
              <CalendarDays className="w-4 h-4" aria-hidden />
              Reservar
            </Link>
            {waReady && waHref && (
              <a
                href={waHref}
                target="_blank"
                rel="noopener noreferrer"
                data-testid={FAQ.ctaWhatsapp}
                className="btn-ghost inline-flex items-center justify-center gap-2 min-h-[48px] px-5 !border-[#25D366]/40 !text-[#25D366] hover:!bg-[#25D366]/10"
                aria-label={`WhatsApp ${settings.whatsapp_display || ""}`}
              >
                <MessageCircle className="w-4 h-4" aria-hidden />
                WhatsApp
              </a>
            )}
          </div>
        </div>
      </div>
    </PageShell>
  );
}
