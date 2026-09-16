"""CPF validation + masking utilities."""
import re


def only_digits(s: str) -> str:
    return re.sub(r"\D", "", s or "")


def mask_cpf(cpf: str) -> str:
    d = only_digits(cpf)
    if len(d) != 11:
        return cpf
    return f"{d[0:3]}.{d[3:6]}.{d[6:9]}-{d[9:11]}"


def validate_cpf(cpf: str) -> bool:
    """Validate Brazilian CPF with check-digit algorithm."""
    d = only_digits(cpf)
    if len(d) != 11:
        return False
    if d == d[0] * 11:
        return False
    # First check digit
    s = sum(int(d[i]) * (10 - i) for i in range(9))
    d1 = (s * 10) % 11
    if d1 == 10:
        d1 = 0
    if d1 != int(d[9]):
        return False
    # Second check digit
    s = sum(int(d[i]) * (11 - i) for i in range(10))
    d2 = (s * 10) % 11
    if d2 == 10:
        d2 = 0
    return d2 == int(d[10])


def normalize_whatsapp(num: str) -> str:
    """Return digits only, prefixed with country code 55 if missing."""
    d = only_digits(num)
    if not d:
        return ""
    if not d.startswith("55"):
        d = "55" + d
    return d


def phone_variants(num: str) -> list[str]:
    """BR WhatsApp digit variants (55 / no-55 / with-without 9th digit)."""
    d = only_digits(num)
    if not d:
        return []
    out = {d}
    if d.startswith("55") and len(d) > 11:
        out.add(d[2:])
    elif not d.startswith("55") and len(d) >= 10:
        out.add("55" + d)
    for v in list(out):
        local = v[2:] if v.startswith("55") else v
        if len(local) == 11 and local[2] == "9":
            without9 = local[:2] + local[3:]
            out.add(without9)
            out.add("55" + without9)
        if len(local) == 10:
            with9 = local[:2] + "9" + local[2:]
            out.add(with9)
            out.add("55" + with9)
    return list(out)


def phones_match(a: str, b: str) -> bool:
    return bool(set(phone_variants(a)) & set(phone_variants(b)))
