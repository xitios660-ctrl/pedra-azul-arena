"""Best-effort WhatsApp alerts to the arena admin on new bookings."""
from __future__ import annotations

import logging
import os
import re
from typing import Any

import site_settings as sset
import whatsapp_bridge

logger = logging.getLogger("arena.admin_alerts")


def _digits(v: str) -> str:
    return re.sub(r"\D", "", v or "")


def is_admin_alert_number_usable(e164: str) -> bool:
    """Skip empty / placeholder numbers — never invent phones."""
    d = _digits(e164)
    if len(d) < 10 or len(d) > 15:
        return False
    # Same seed placeholder family as public WA (4002-8922)
    if d.endswith("40028922"):
        return False
    return True


def _public_origin() -> str:
    return (
        os.environ.get("PUBLIC_APP_URL")
        or os.environ.get("FRONTEND_URL")
        or os.environ.get("RENDER_EXTERNAL_URL")
        or ""
    ).rstrip("/")


def format_admin_new_booking_msg(booking: dict[str, Any]) -> str:
    name = (booking.get("customer_name") or "Cliente").strip() or "Cliente"
    date = booking.get("date") or "?"
    time = booking.get("start_time") or "?"
    total = booking.get("total")
    try:
        valor = f"R$ {float(total):.0f}" if total is not None else ""
    except (TypeError, ValueError):
        valor = ""
    line = f"Nova reserva — {name} · {date} · {time}"
    if valor:
        line += f" · {valor}"
    origin = _public_origin()
    if origin:
        line += f"\n{origin}/admin"
    else:
        bid = (booking.get("id") or "")[:8]
        if bid:
            line += f"\nid {bid}"
    return line


async def notify_admin_new_booking(db, booking: dict[str, Any]) -> bool:
    """If WA CONECTADO and admin number set — send short PT alert. Never raises / never fails booking."""
    try:
        settings = await sset.get_admin_settings(db)
        if not settings.get("admin_alerts_enabled", True):
            return False
        phone = (settings.get("admin_whatsapp_e164") or "").strip()
        if not is_admin_alert_number_usable(phone):
            return False
        st = await whatsapp_bridge.get_status()
        if (st.get("status") or "").upper() != "CONECTADO":
            return False
        msg = format_admin_new_booking_msg(booking)
        sent = await whatsapp_bridge.send_text(_digits(phone), msg)
        if sent:
            logger.info(
                "event=admin_alert_sent booking_id=%s",
                str(booking.get("id") or "")[:8],
            )
        return bool(sent)
    except Exception as e:
        logger.warning("admin alert failed: %s", e)
        return False
