/**
 * @jest-environment node
 */
import {
  buildReceiptShareText,
  buildReceiptWhatsAppUrl,
  formatReceiptDate,
  formatReceiptDuration,
  formatReceiptTimeRange,
  receiptStatusLabel,
  canUseWebShare,
} from "./bookingReceipt";

describe("bookingReceipt helpers", () => {
  const booking = {
    court_name: "Quadra Pedra Azul — Núncio",
    date: "2026-09-20",
    start_time: "19:00",
    end_time: "21:00",
    duration_minutes: 120,
    customer_name: "Maria Souza",
    deposit: 78,
    status: "confirmed",
  };

  test("formatReceiptDate uses pt-BR", () => {
    expect(formatReceiptDate("2026-09-20")).toBe("20/09/2026");
  });

  test("formatReceiptDuration for 2h", () => {
    expect(formatReceiptDuration(booking)).toBe("2 horas");
    expect(formatReceiptDuration({ duration_minutes: 60 })).toBe("1 hora");
  });

  test("formatReceiptTimeRange", () => {
    expect(formatReceiptTimeRange(booking)).toBe("19:00–21:00");
    expect(formatReceiptTimeRange({ start_time: "10:00" })).toBe("10:00");
  });

  test("receiptStatusLabel", () => {
    expect(receiptStatusLabel(booking)).toBe("Confirmado");
    expect(receiptStatusLabel({ status: "awaiting_admin" })).toBe("Comprovante informado");
  });

  test("buildReceiptShareText is natural Portuguese", () => {
    const text = buildReceiptShareText(booking, { address_label: "Núncio · Alto Tietê · SP" });
    expect(text).toContain("comprovante da minha reserva");
    expect(text).toContain("Quadra: Quadra Pedra Azul — Núncio");
    expect(text).toContain("Data: 20/09/2026");
    expect(text).toContain("Horário: 19:00–21:00 (2 horas)");
    expect(text).toContain("Nome: Maria Souza");
    expect(text).toContain("Status: Confirmado");
    expect(text).toContain("Local: Núncio · Alto Tietê · SP");
    expect(text).toContain("Qualquer dúvida");
    expect(text).not.toMatch(/BOOKING_ID|null|undefined/i);
  });

  test("buildReceiptWhatsAppUrl encodes text (chat picker)", () => {
    const url = buildReceiptWhatsAppUrl("Olá reserva");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("Olá reserva");
  });

  test("canUseWebShare is false in node", () => {
    expect(canUseWebShare()).toBe(false);
  });
});
