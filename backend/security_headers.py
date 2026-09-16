"""HTTP security headers middleware (Cycle 41).

Pure ASGI (not BaseHTTPMiddleware) so StreamingResponse / SSE
(WhatsApp admin QR events) is not buffered or broken.
"""
from __future__ import annotations

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

# Pragmatic CSP for CRA SPA:
# - Google Fonts (index.html + index.css @import)
# - React inline styles (style={...} across pages)
# - Inline script in public/index.html (DataCloneError guard)
# - data:/blob: images (WhatsApp QR data-URL, createObjectURL downloads)
# - connect-src 'self' keeps EventSource /api/admin/whatsapp/events + API
# - wa.me / Google Maps are top-level navigations — not blocked by connect-src
SECURITY_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "object-src 'none'; "
    "frame-ancestors 'none'; "
    "form-action 'self'; "
    "script-src 'self' 'unsafe-inline'; "
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; "
    "img-src 'self' data: blob:; "
    "connect-src 'self'; "
    "worker-src 'self'; "
    "manifest-src 'self'"
)

SECURITY_PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()"


class SecurityHeadersMiddleware:
    """Attach safe default security headers to every HTTP response."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault(
                    "Referrer-Policy", "strict-origin-when-cross-origin"
                )
                headers.setdefault("Permissions-Policy", SECURITY_PERMISSIONS_POLICY)
                headers.setdefault("Content-Security-Policy", SECURITY_CSP)
            await send(message)

        await self.app(scope, receive, send_wrapper)
