"""Live-signal tools backed by free, keyless public APIs.

Every tool stays useful offline: live data is preferred, and when a provider is
unreachable the tool falls back to a small, clearly-labelled sample. Output is
always JSON with a ``source`` key (``live``, ``sample``, ``partial`` or
``unavailable``) plus a ``note`` the assistant can pass on, matching the
marketplace BFF tools. Set ``LIVE_DATA_TOOLS_LIVE=0`` to force sample mode.
"""
from __future__ import annotations

import ipaddress
import json
import os
from datetime import date as _date
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from langchain_core.tools import tool

_MAX_CHARS = 20_000
_HEADERS = {"User-Agent": "vela-agent/1.0", "accept": "application/json"}


def _live_enabled() -> bool:
    return os.environ.get("LIVE_DATA_TOOLS_LIVE", "1").lower() not in ("0", "false", "no", "off")


def _timeout() -> float:
    try:
        return float(os.environ.get("LIVE_DATA_TOOLS_TIMEOUT", "8"))
    except ValueError:
        return 8.0


def _get(url: str, params: dict | None = None) -> Any:
    kwargs = dict(params=params, headers=_HEADERS, timeout=_timeout(), follow_redirects=True)
    try:
        resp = httpx.get(url, **kwargs)
    except httpx.InvalidURL:
        # Some hosts ship an unparseable NO_PROXY (e.g. "[::1]"); retry without env proxies.
        resp = httpx.get(url, trust_env=False, **kwargs)
    resp.raise_for_status()
    return resp.json()


def _out(source: str, **payload: Any) -> str:
    return json.dumps({"source": source, **payload}, ensure_ascii=False)[:_MAX_CHARS]


def _note(reason: Exception | str) -> str:
    detail = str(reason).splitlines()[0][:160] if str(reason) else "unavailable"
    return f"Live data unavailable ({detail}); showing bundled sample data."


# ── FX conversion (open.er-api.com, free, no key) ────────────────────
# 1 TZS in each currency; only used when the live provider cannot be reached.
_TZS_RATES = {
    "TZS": 1.0, "USD": 0.00038, "EUR": 0.00035, "GBP": 0.00030, "KES": 0.049,
    "UGX": 1.45, "RWF": 0.53, "ZAR": 0.0069, "CNY": 0.0027, "INR": 0.032,
    "AED": 0.0014, "JPY": 0.058, "NGN": 0.59,
}


@tool("fx_convert")
def fx_convert(amount: float, from_currency: str, to_currency: str) -> str:
    """Convert an amount between currencies at the latest published daily rate.
    Use for cross-border prices, settlement values and thresholds stated in TZS,
    KES, USD, EUR and other ISO codes. Returns the rate, its publication date and
    the converted amount; quote the rate date when the customer cares about timing."""
    base = (from_currency or "").strip().upper()
    quote = (to_currency or "").strip().upper()
    try:
        amt = float(amount)
    except (TypeError, ValueError):
        return _out("unavailable", error="amount must be a number")
    if not base or not quote:
        return _out("unavailable", error="from_currency and to_currency are required")
    if base == quote:
        return _out("live", **{"from": base, "to": quote, "rate": 1.0,
                               "amount_from": amt, "amount_to": amt, "provider": "identity"})
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        data = _get(f"https://open.er-api.com/v6/latest/{base}")
        if data.get("result") != "success":
            raise RuntimeError(data.get("error-type") or "rate service error")
        rate = (data.get("rates") or {}).get(quote)
        if rate is None:
            raise RuntimeError(f"no {quote} rate for {base}")
        return _out("live", **{"from": base, "to": quote, "rate": round(float(rate), 6),
                               "amount_from": amt, "amount_to": round(amt * float(rate), 2),
                               "rate_date": data.get("time_last_update_utc"),
                               "provider": "open.er-api.com"})
    except Exception as e:  # noqa: BLE001 - labelled fallback
        rb, rq = _TZS_RATES.get(base), _TZS_RATES.get(quote)
        if rb is None or rq is None:
            return _out("unavailable", error=f"No rate for {base}/{quote}: {e}"[:300])
        rate = rq / rb
        return _out("sample", **{"from": base, "to": quote, "rate": round(rate, 6),
                                 "amount_from": amt, "amount_to": round(amt * rate, 2),
                                 "note": _note(e)})


# ── public holidays (date.nager.at, free, no key) ────────────────────
_COUNTRY_ALIASES = {
    "TANZANIA": "TZ", "KENYA": "KE", "UGANDA": "UG", "RWANDA": "RW", "BURUNDI": "BI",
    "SOUTH SUDAN": "SS", "ZAMBIA": "ZM", "MALAWI": "MW", "MOZAMBIQUE": "MZ",
    "NIGERIA": "NG", "SOUTH AFRICA": "ZA", "UNITED KINGDOM": "GB", "UK": "GB",
    "GREAT BRITAIN": "GB", "UNITED STATES": "US", "USA": "US", "GERMANY": "DE",
    "FRANCE": "FR", "INDIA": "IN", "CHINA": "CN", "UAE": "AE", "EMIRATES": "AE",
}

# month, day, name; only used when the live calendar cannot be reached.
_SAMPLE_HOLIDAYS = {
    "TZ": [(1, 1, "New Year's Day"), (1, 12, "Zanzibar Revolution Day"), (4, 26, "Union Day"),
           (5, 1, "Worker's Day"), (7, 7, "Saba Saba"), (8, 8, "Nane Nane (Farmers' Day)"),
           (10, 14, "Nyerere Day"), (12, 9, "Independence Day"), (12, 25, "Christmas Day"),
           (12, 26, "Boxing Day")],
    "KE": [(1, 1, "New Year's Day"), (5, 1, "Labour Day"), (6, 1, "Madaraka Day"),
           (10, 10, "Huduma Day"), (10, 20, "Mashujaa Day"), (12, 12, "Jamhuri Day"),
           (12, 25, "Christmas Day"), (12, 26, "Utamaduni Day")],
    "UG": [(1, 1, "New Year's Day"), (1, 26, "Liberation Day"), (3, 8, "International Women's Day"),
           (5, 1, "Labour Day"), (6, 3, "Martyrs' Day"), (6, 9, "National Heroes Day"),
           (10, 9, "Independence Day"), (12, 25, "Christmas Day"), (12, 26, "Boxing Day")],
}


def _country_code(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return "TZ"
    if len(raw) in (2, 3) and raw.isalpha():
        return raw.upper()
    return _COUNTRY_ALIASES.get(raw.upper(), raw.upper()[:2])


def _fetch_holidays(code: str, year: int) -> list[dict[str, Any]]:
    data = _get(f"https://date.nager.at/api/v3/PublicHolidays/{year}/{code}")
    if not isinstance(data, list):
        raise RuntimeError("unexpected holiday payload")
    rows = [
        {"date": h.get("date"), "name": h.get("name"), "local_name": h.get("localName")}
        for h in data if h.get("date")
    ]
    return sorted(rows, key=lambda h: h["date"])


def _sample_holiday_rows(code: str, year: int) -> list[dict[str, Any]]:
    rows = [
        {"date": f"{year}-{m:02d}-{d:02d}", "name": name, "local_name": name}
        for m, d, name in _SAMPLE_HOLIDAYS.get(code, _SAMPLE_HOLIDAYS["TZ"])
    ]
    return sorted(rows, key=lambda h: h["date"])


@tool("public_holidays")
def public_holidays(country: str = "TZ", year: int | None = None) -> str:
    """List public holidays for a country (ISO code or name, default Tanzania) and
    year (default this year). Use before quoting settlement, delivery or SLA dates:
    a promise that lands on a holiday is a missed promise. Returns dates, names and
    the next upcoming holiday."""
    code = _country_code(country)
    try:
        year = int(year) if year not in (None, "") else datetime.now(timezone.utc).year
    except (TypeError, ValueError):
        year = datetime.now(timezone.utc).year
    if not 1990 <= year <= 2100:
        return _out("unavailable", error="year must be between 1990 and 2100")
    today = datetime.now(timezone.utc).date().isoformat()
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        rows = _fetch_holidays(code, year)
        source = "live"
        note = ""
    except Exception as e:  # noqa: BLE001
        rows = _sample_holiday_rows(code, year)
        source, note = "sample", _note(e)
    upcoming = next((h for h in rows if h["date"] >= today), None)
    payload: dict[str, Any] = {"country": code, "year": year, "count": len(rows), "holidays": rows}
    if upcoming:
        payload["next"] = {"date": upcoming["date"], "name": upcoming["name"], "days_away": (
            _date.fromisoformat(upcoming["date"]) - _date.fromisoformat(today)).days}
    if note:
        payload["note"] = note
    return _out(source, **payload)


def _holiday_map(code: str, year: int) -> tuple[dict[str, str], str, str]:
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        return {h["date"]: h["name"] for h in _fetch_holidays(code, year)}, "live", ""
    except Exception as e:  # noqa: BLE001
        if code in _SAMPLE_HOLIDAYS:
            return {h["date"]: h["name"] for h in _sample_holiday_rows(code, year)}, "sample", _note(e)
        return {}, "partial", f"Holiday calendar unavailable ({e}); weekends only."


@tool("next_business_day")
def next_business_day(country: str = "TZ", date: str = "", days: int = 1) -> str:
    """Add business days to a date, skipping weekends and that country's public
    holidays. Use for SLAs, settlement windows and delivery promises ("within two
    business days"). date is ISO (YYYY-MM-DD, default today); days must be positive.
    Returns the due date and which dates were skipped and why."""
    code = _country_code(country)
    try:
        start = _date.fromisoformat(date) if date else datetime.now(timezone.utc).date()
    except ValueError:
        return _out("unavailable", error="date must be YYYY-MM-DD")
    try:
        count = int(days)
    except (TypeError, ValueError):
        return _out("unavailable", error="days must be a whole number")
    if count < 1 or count > 250:
        return _out("unavailable", error="days must be between 1 and 250")
    calendar: dict[str, str] = {}
    notes: list[str] = []
    sources: list[str] = []
    for year in {start.year, (start + timedelta(days=count * 3 + 31)).year}:
        rows, source, note = _holiday_map(code, year)
        calendar.update(rows)
        sources.append(source)
        if note:
            notes.append(note)
    skipped: list[dict[str, str]] = []
    cur = start
    added = 0
    while added < count:
        cur += timedelta(days=1)
        if cur.weekday() >= 5:
            skipped.append({"date": cur.isoformat(), "reason": "weekend"})
        elif cur.isoformat() in calendar:
            skipped.append({"date": cur.isoformat(), "reason": calendar[cur.isoformat()]})
        else:
            added += 1
    source = "live" if all(s == "live" for s in sources) else ("sample" if "sample" in sources else "partial")
    payload: dict[str, Any] = {"country": code, "start_date": start.isoformat(),
                               "business_days": count, "due_date": cur.isoformat(), "skipped": skipped}
    if notes:
        payload["note"] = " ".join(dict.fromkeys(notes))[:300]
    return _out(source, **payload)


# ── country profile (World Bank + countriesnow, free, no key) ────────
_SAMPLE_COUNTRIES = {
    "TZ": {"name": "Tanzania", "iso2": "TZ", "iso3": "TZA", "region": "Sub-Saharan Africa",
           "income_level": "Lower middle income", "capital": "Dodoma",
           "currencies": [{"code": "TZS", "name": "Tanzanian shilling"}],
           "dialing_prefix": "+255", "latitude": -6.17, "longitude": 35.74},
    "KE": {"name": "Kenya", "iso2": "KE", "iso3": "KEN", "region": "Sub-Saharan Africa",
           "income_level": "Lower middle income", "capital": "Nairobi",
           "currencies": [{"code": "KES", "name": "Kenyan shilling"}],
           "dialing_prefix": "+254", "latitude": -1.28, "longitude": 36.81},
    "UG": {"name": "Uganda", "iso2": "UG", "iso3": "UGA", "region": "Sub-Saharan Africa",
           "income_level": "Low income", "capital": "Kampala",
           "currencies": [{"code": "UGX", "name": "Ugandan shilling"}],
           "dialing_prefix": "+256", "latitude": 1.37, "longitude": 32.29},
    "RW": {"name": "Rwanda", "iso2": "RW", "iso3": "RWA", "region": "Sub-Saharan Africa",
           "income_level": "Low income", "capital": "Kigali",
           "currencies": [{"code": "RWF", "name": "Rwandan franc"}],
           "dialing_prefix": "+250", "latitude": -1.94, "longitude": 29.87},
}


_NAME_PREFIXES = ("united republic of ", "republic of ", "kingdom of ", "the ")


def _wb_rows(query: str) -> list[dict[str, Any]]:
    q = query.strip()
    if len(q) in (2, 3) and q.isalpha():
        data = _get(f"https://api.worldbank.org/v2/country/{q.upper()}", {"format": "json"})
        return data[1] if isinstance(data, list) and len(data) > 1 and isinstance(data[1], list) else []
    candidates = [q]
    low = q.lower()
    for prefix in _NAME_PREFIXES:
        if low.startswith(prefix) and len(q) > len(prefix):
            candidates.append(q[len(prefix):])
    data = _get("https://api.worldbank.org/v2/country", {"format": "json", "per_page": "400"})
    rows = data[1] if isinstance(data, list) and len(data) > 1 and isinstance(data[1], list) else []
    for cand in candidates:
        exact = [r for r in rows if (r.get("name") or "").lower() == cand.lower()]
        if exact:
            return exact
    return [r for r in rows if q.lower() in (r.get("name") or "").lower()]


def _currency_row(iso2: str) -> dict[str, Any] | None:
    data = _get("https://countriesnow.space/api/v0.1/countries/info",
                {"returns": "currency,dialCode,iso2"})
    for row in data.get("data") or []:
        if (row.get("iso2") or "").upper() == iso2:
            return row
    return None


def _float(value: Any) -> float | None:
    try:
        return round(float(value), 3)
    except (TypeError, ValueError):
        return None


@tool("country_profile")
def country_profile(country: str = "TZ") -> str:
    """Look up a country profile: ISO codes, region, income level, capital, currency,
    dialing prefix and coordinates. Use it during onboarding or cross-border checks
    instead of assuming a currency or country code. Accepts an ISO code or a country
    name (English)."""
    raw = (country or "TZ").strip()
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        rows = _wb_rows(raw)
        if not rows:
            raise RuntimeError(f"no country matched {country!r}")
        wb = rows[0]
        profile: dict[str, Any] = {
            "name": wb.get("name"), "iso2": wb.get("iso2Code"), "iso3": wb.get("id"),
            "region": ((wb.get("region") or {}).get("value") or "").strip() or None,
            "income_level": (wb.get("incomeLevel") or {}).get("value"),
            "capital": wb.get("capitalCity"),
            "currencies": [], "dialing_prefix": None,
            "latitude": _float(wb.get("latitude")), "longitude": _float(wb.get("longitude")),
        }
        note = ""
        try:
            extra = _currency_row(profile["iso2"] or "")
            if extra:
                if extra.get("currency"):
                    profile["currencies"] = [{"code": extra["currency"]}]
                if extra.get("dialCode"):
                    profile["dialing_prefix"] = f"+{str(extra['dialCode']).lstrip('+')}"
            else:
                note = "Currency and dialing code not found for this country."
        except Exception as e:  # noqa: BLE001 - profile still useful without currency
            note = f"Currency lookup unavailable ({e}); other fields are live."
        payload = {"country": profile, "provider": "worldbank.org"}
        if note:
            payload["note"] = note[:300]
        return _out("live", **payload)
    except Exception as e:  # noqa: BLE001
        row = _SAMPLE_COUNTRIES.get(_country_code(raw))
        if row is None:
            return _out("unavailable", error=f"No profile for {country!r}: {e}"[:300])
        return _out("sample", country=row, note=_note(e))


# ── IP geolocation (ipwho.is, free, no key) ─────────────────────────
@tool("ip_location")
def ip_location(ip: str) -> str:
    """Geolocate a public IP address: country, region, city, timezone, ISP and ASN.
    Use as a location and fraud signal for orders and sessions. Private, loopback
    and reserved addresses are refused. No sample fallback: this must be real."""
    raw = (ip or "").strip()
    if not raw:
        return _out("unavailable", error="ip is required")
    try:
        addr = ipaddress.ip_address(raw)
    except ValueError:
        return _out("unavailable", error=f"{ip!r} is not an IP address")
    if addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved or addr.is_multicast:
        return _out("unavailable", error="Only public IP addresses can be located")
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        data = _get(f"https://ipwho.is/{addr}")
        if not data.get("success"):
            raise RuntimeError(data.get("message") or "lookup failed")
        return _out("live", ip=str(addr), country=data.get("country"), country_code=data.get("country_code"),
                    region=data.get("region"), city=data.get("city"),
                    timezone=(data.get("timezone") or {}).get("id"),
                    isp=(data.get("connection") or {}).get("isp"),
                    asn=(data.get("connection") or {}).get("asn"),
                    latitude=data.get("latitude"), longitude=data.get("longitude"),
                    provider="ipwho.is")
    except Exception as e:  # noqa: BLE001
        return _out("unavailable", error=f"IP lookup failed: {e}"[:300])


# ── local weather (open-meteo.com, free, no key) ─────────────────────
_WMO = {0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
        51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain",
        65: "heavy rain", 66: "freezing rain", 67: "heavy freezing rain", 71: "light snow", 73: "snow",
        75: "heavy snow", 80: "rain showers", 81: "heavy showers", 82: "violent showers",
        95: "thunderstorm", 96: "thunderstorm with hail", 99: "severe thunderstorm with hail"}


def _weather_text(code: Any) -> str:
    try:
        return _WMO.get(int(code), f"code {code}")
    except (TypeError, ValueError):
        return "unknown"


@tool("local_weather")
def local_weather(city: str = "Dar es Salaam", country_code: str = "TZ") -> str:
    """Current conditions and a three-day forecast for a city: temperature,
    precipitation, wind and a plain-language condition. Use for field visits,
    delivery delays and network-site work where rain matters. Geocodes the city
    first, so pass country_code to disambiguate repeated names."""
    raw = (city or "Dar es Salaam").strip()
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        geo = _get("https://geocoding-api.open-meteo.com/v1/search",
                   {"name": raw, "count": 1, "language": "en", "format": "json",
                    **({"countryCode": country_code.strip().upper()} if country_code.strip() else {})})
        hits = geo.get("results") or []
        if not hits:
            raise RuntimeError(f"no place matched {city!r}")
        place = hits[0]
        data = _get("https://api.open-meteo.com/v1/forecast", {
            "latitude": place["latitude"], "longitude": place["longitude"],
            "current": "temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
            "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max",
            "forecast_days": 3, "timezone": "auto",
        })
        cur = data.get("current") or {}
        day = data.get("daily") or {}
        dates = day.get("time") or []
        daily = [{
            "date": dates[i],
            "condition": _weather_text((day.get("weather_code") or [None] * 3)[i]),
            "max_c": (day.get("temperature_2m_max") or [None] * 3)[i],
            "min_c": (day.get("temperature_2m_min") or [None] * 3)[i],
            "rain_mm": (day.get("precipitation_sum") or [None] * 3)[i],
            "rain_chance_pct": (day.get("precipitation_probability_max") or [None] * 3)[i],
        } for i in range(len(dates))]
        rain_72h = round(sum(float(d["rain_mm"] or 0) for d in daily), 1)
        return _out("live", location={"name": place.get("name"), "country": place.get("country"),
                                      "country_code": place.get("country_code"),
                                      "latitude": place.get("latitude"), "longitude": place.get("longitude")},
                    timezone=data.get("timezone"),
                    current={"temp_c": cur.get("temperature_2m"), "humidity_pct": cur.get("relative_humidity_2m"),
                             "rain_mm": cur.get("precipitation"), "wind_kmh": cur.get("wind_speed_10m"),
                             "condition": _weather_text(cur.get("weather_code"))},
                    daily=daily, rain_next_72h_mm=rain_72h, provider="open-meteo.com")
    except Exception as e:  # noqa: BLE001
        return _out("unavailable", error=f"Weather lookup failed: {e}"[:300])
