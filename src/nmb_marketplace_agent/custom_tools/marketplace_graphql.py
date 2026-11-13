"""Marketplace BFF tools: product, FAQ, policy and order lookups over GraphQL.

The pack ships against the NMB marketplace UAT BFF. Every tool calls the live
endpoint when it is reachable and falls back to bundled sample data otherwise,
so demos work offline. Set ``MARKETPLACE_GRAPHQL_TOKEN`` for buyer-authenticated
queries (order status); ``MARKETPLACE_GRAPHQL_LIVE=0`` forces sample mode.

Tool output is always JSON with a ``source`` key (``live`` or ``sample``) so the
assistant can tell the user when it is showing demo data.
"""
from __future__ import annotations

import json
import os
from typing import Any
from urllib.parse import urlparse

import httpx
from langchain_core.tools import tool

DEFAULT_URL = "https://api.marketplaceuat.nmbtz.com/svc/mpBff/graphql"
_METADATA = {"channel": "WEB", "userType": "BUYER"}
_MAX_CHARS = 20_000

_SAMPLE_PRODUCTS: list[dict[str, Any]] = [
    {
        "productId": "344", "name": "Iphone 18 Duo", "brand": "Apple", "price": 200000,
        "currency": "TZS", "quantity": 10, "storeId": "74", "active": True,
        "category": {"name": "electronics"},
        "shortDescription": "Iphone 19 Duo",
        "description": "Dual-SIM smartphone with 256GB storage and a 6.5-inch display.",
        "features": ["256GB", "Dual SIM", "Face unlock"],
        "tags": ["phone", "smartphone"],
    },
    {
        "productId": "341", "name": "Iphone 16 Promax", "brand": "Apple", "price": 200000,
        "currency": "TZS", "quantity": 144, "storeId": "66", "active": True,
        "category": {"name": "electronics"},
        "shortDescription": "Iphone 19 Promax",
        "description": "Large-screen smartphone with an advanced camera system.",
        "features": ["512GB", "Triple camera", "5G"],
        "tags": ["phone", "smartphone"],
    },
    {
        "productId": "349", "name": "Sucre Rollex Grande", "brand": "Sucre", "price": 200000,
        "currency": "TZS", "quantity": 20, "storeId": "59", "active": True,
        "category": {"name": "fashion & apparel"},
        "shortDescription": "Authentic Rolex luxury timepiece",
        "description": "Stainless-steel luxury watch with automatic movement.",
        "features": ["Automatic", "Water resistant 100m"],
        "tags": ["watch", "luxury"],
    },
    {
        "productId": "410", "name": "Techno Spark 30", "brand": "Tecno", "price": 380000,
        "currency": "TZS", "quantity": 35, "storeId": "74", "active": True,
        "category": {"name": "electronics"},
        "shortDescription": "Affordable smartphone with a long-life battery",
        "description": "Entry-level smartphone with 6000mAh battery and 128GB storage.",
        "features": ["128GB", "6000mAh", "Dual SIM"],
        "tags": ["phone", "budget"],
    },
]

_SAMPLE_FAQS: list[dict[str, Any]] = [
    {
        "id": "faq-delivery", "category": "Delivery", "audienceType": "BUYER",
        "question": "How long does delivery take?",
        "answer": ("Orders inside Dar es Salaam usually arrive in 1-3 business days; "
                   "up-country deliveries take 3-7 business days. Sellers dispatch "
                   "within 48 hours of a confirmed payment."),
    },
    {
        "id": "faq-payments", "category": "Payments", "audienceType": "BUYER",
        "question": "Which payment methods are accepted?",
        "answer": ("Mobile money, debit and credit cards, and cash on delivery where "
                   "the seller supports it. Payment is held until the order is delivered."),
    },
    {
        "id": "faq-returns", "category": "Returns", "audienceType": "BUYER",
        "question": "Can I return an item?",
        "answer": ("Unused items in original packaging can be returned within 7 days "
                   "of delivery. Perishables, digital goods and personalised items are "
                   "not returnable."),
    },
    {
        "id": "faq-sellers", "category": "Selling", "audienceType": "SELLER",
        "question": "How do I start selling on the marketplace?",
        "answer": ("Complete merchant onboarding with your business licence and TIN, "
                   "then create a store. Product listings are reviewed before going live."),
    },
]

_SAMPLE_POLICIES: list[dict[str, Any]] = [
    {
        "id": "pol-shipping", "type": "SHIPPING_POLICY", "title": "Shipping policy",
        "version": "1.0", "status": "ACTIVE",
        "content": ("Sellers must dispatch paid orders within 48 hours. Delivery fees are "
                    "shown at checkout. Undelivered orders are refunded in full."),
    },
    {
        "id": "pol-returns", "type": "RETURN_POLICY", "title": "Returns and refunds",
        "version": "1.0", "status": "ACTIVE",
        "content": ("Buyers may request a return within 7 days of delivery for unused items "
                    "in original packaging. Refunds are issued to the original payment method "
                    "within 5 business days of the returned item being received."),
    },
    {
        "id": "pol-privacy", "type": "PRIVACY_POLICY", "title": "Privacy policy",
        "version": "1.0", "status": "ACTIVE",
        "content": ("Buyer and seller data is processed under the Kenya Data Protection Act. "
                    "Phone numbers and identity documents are used only to verify accounts and "
                    "fulfil orders, and are never shared with other buyers."),
    },
]

_SAMPLE_ORDERS: list[dict[str, Any]] = [
    {
        "orderId": "ORD-100245", "order_status": "IN_TRANSIT", "payment_status": "PAID",
        "shipping_status": "IN_TRANSIT", "order_amount": 200000.0,
        "remarks": "Courier: NMB Express", "createdon": "2026-11-02T09:15:00Z",
        "items": [{"productId": "344", "productName": "Iphone 18 Duo",
                   "quantity": 1.0, "price": 200000.0, "storeName": "Kariakoo Tech"}],
    },
    {
        "orderId": "ORD-100246", "order_status": "PROCESSING", "payment_status": "PENDING",
        "shipping_status": "AWAITING_PICKUP", "order_amount": 380000.0,
        "remarks": "Awaiting seller dispatch", "createdon": "2026-11-05T14:40:00Z",
        "items": [{"productId": "410", "productName": "Techno Spark 30",
                   "quantity": 1.0, "price": 380000.0, "storeName": "Kariakoo Tech"}],
    },
]


def _live_enabled() -> bool:
    return os.environ.get("MARKETPLACE_GRAPHQL_LIVE", "1").lower() not in ("0", "false", "no", "off")


def _execute(query: str, variables: dict[str, Any]) -> dict[str, Any]:
    url = os.environ.get("MARKETPLACE_GRAPHQL_URL", DEFAULT_URL).strip() or DEFAULT_URL
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("MARKETPLACE_GRAPHQL_URL must be an http(s) URL")
    headers = {"content-type": "application/json", "accept": "application/json"}
    token = os.environ.get("MARKETPLACE_GRAPHQL_TOKEN", "").strip()
    if token:
        headers["authorization"] = f"Bearer {token}"
    verify = os.environ.get("MARKETPLACE_TLS_VERIFY", "true").lower() not in ("0", "false", "no", "off")
    kwargs = dict(
        json={"query": query, "variables": variables}, headers=headers,
        timeout=float(os.environ.get("MARKETPLACE_GRAPHQL_TIMEOUT", "15")), verify=verify,
    )
    try:
        resp = httpx.post(url, **kwargs)
    except httpx.InvalidURL:
        # Some hosts ship an unparseable NO_PROXY (e.g. "[::1]"); retry without env proxies.
        resp = httpx.post(url, trust_env=False, **kwargs)
    resp.raise_for_status()
    body = resp.json()
    if body.get("errors"):
        message = "; ".join(str(e.get("message", e)) for e in body["errors"])
        raise RuntimeError(message[:300])
    return body.get("data") or {}


def _render(source: str, key: str, payload: Any, note: str = "") -> str:
    out: dict[str, Any] = {"source": source, key: payload}
    if note:
        out["note"] = note
    return json.dumps(out, ensure_ascii=False)[:_MAX_CHARS]


def _sample_note(reason: Exception | str) -> str:
    detail = str(reason).splitlines()[0][:160] if str(reason) else "unavailable"
    return f"Live marketplace unavailable ({detail}); showing bundled sample data."


def _sample_products(term: str, category: str, max_price: float | None, size: int) -> list[dict]:
    t = term.lower().strip()
    c = category.lower().strip()
    rows = [
        p for p in _SAMPLE_PRODUCTS
        if (not t or t in p["name"].lower() or t in (p.get("shortDescription") or "").lower()
            or any(t in tag for tag in p.get("tags", [])))
        and (not c or c in (p.get("category") or {}).get("name", "").lower())
        and (max_price is None or p["price"] <= max_price)
    ]
    return rows[:size]


_PRODUCTS_QUERY = """
query Products($input: Get_Product_Input!) {
  getProduct(getProductInput: $input) {
    success
    narration
    data {
      productId name brand price compareAtPrice currency quantity active status
      shortDescription description features tags storeId
      category { name } store { name }
    }
  }
}
"""

_FAQ_QUERY = """
query Faqs($input: Get_Faq_Input!) {
  getFaqs(getFaqInput: $input) {
    success
    narration
    data { id question answer category audienceType status }
  }
}
"""

_POLICY_QUERY = """
query Policies($input: Get_Policy_Input!) {
  getPolicies(getPolicyInput: $input) {
    success
    narration
    data { id type title content version status }
  }
}
"""

_ORDER_QUERY = """
query OrderById($input: Get_OrderById_Input!) {
  getOrderById(getOrderByIdInput: $input) {
    success
    narration
    orders {
      orderId order_status payment_status shipping_status order_amount remarks
      createdon updatedon
      items { productId productName quantity price storeName }
    }
  }
}
"""


@tool("marketplace_search_products")
def marketplace_search_products(
    search_term: str = "",
    category: str = "",
    max_price: float | None = None,
    size: int = 5,
) -> str:
    """Search the NMB Marketplace catalogue. Returns product ids, names, prices,
    currencies, stock, store ids and categories. Leave search_term empty to browse.
    category is a marketplace category such as "electronics"; max_price is in
    marketplace currency (TZS)."""
    size = max(1, min(int(size or 5), 10))
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        criteria: dict[str, Any] = {"size": size, "page": 1}
        if search_term.strip():
            # UAT's getProduct only applies searchTerm against the fields listed here.
            criteria["searchTerm"] = search_term.strip()
            criteria["searchFields"] = "name"
        if category.strip():
            criteria["category"] = category.strip()
        if max_price is not None:
            criteria["maxPrice"] = float(max_price)
        data = _execute(_PRODUCTS_QUERY, {"input": {"searchCriteria": criteria, "metadata": _METADATA}})
        result = data.get("getProduct") or {}
        return _render("live", "products", result.get("data") or [],
                       result.get("narration") or "")
    except Exception as e:  # noqa: BLE001 — fall back to bundled samples
        rows = _sample_products(search_term, category, max_price, size)
        return _render("sample", "products", rows, _sample_note(e))


@tool("marketplace_product_details")
def marketplace_product_details(product_id: str) -> str:
    """Fetch one marketplace product by id: price, stock, description, features,
    tags, category and store. Use this after a search when the buyer asks for
    specifics about a listing."""
    product_id = product_id.strip()
    if not product_id:
        return _render("live", "product", None, "product_id is required")
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        data = _execute(_PRODUCTS_QUERY, {"input": {"productId": product_id, "metadata": _METADATA}})
        result = data.get("getProduct") or {}
        rows = result.get("data") or []
        return _render("live", "product", rows[0] if rows else None,
                       result.get("narration") or ("" if rows else f"No product with id {product_id}."))
    except Exception as e:  # noqa: BLE001
        row = next((p for p in _SAMPLE_PRODUCTS if p["productId"] == product_id), None)
        note = _sample_note(e)
        if row is None:
            note += f" Sample product ids: {', '.join(p['productId'] for p in _SAMPLE_PRODUCTS)}."
        return _render("sample", "product", row, note)


@tool("marketplace_faqs")
def marketplace_faqs(audience: str = "BUYER", category: str = "") -> str:
    """Answer buyer or seller how-to questions (delivery, payments, returns,
    onboarding) from the marketplace FAQ service. audience is BUYER or SELLER;
    category optionally filters, e.g. "Delivery"."""
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        data = _execute(_FAQ_QUERY, {"input": {"audienceType": audience.strip().upper() or "BUYER",
                                               "metadata": _METADATA}})
        result = data.get("getFaqs") or {}
        rows = result.get("data") or []
        if category.strip():
            c = category.strip().lower()
            rows = [r for r in rows if c in (r.get("category") or "").lower()]
        return _render("live", "faqs", rows, result.get("narration") or "")
    except Exception as e:  # noqa: BLE001
        rows = [f for f in _SAMPLE_FAQS if f["audienceType"] == (audience.strip().upper() or "BUYER")]
        if category.strip():
            c = category.strip().lower()
            rows = [r for r in rows if c in r["category"].lower()]
        return _render("sample", "faqs", rows, _sample_note(e))


@tool("marketplace_policies")
def marketplace_policies(policy_type: str = "") -> str:
    """Read marketplace policies: shipping, returns and refunds, privacy, terms.
    policy_type optionally filters (e.g. "SHIPPING_POLICY", "PRIVACY_POLICY").
    Quote the policy title and version when answering."""
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        data = _execute(_POLICY_QUERY, {"input": {"metadata": _METADATA}})
        result = data.get("getPolicies") or {}
        rows = result.get("data") or []
        if policy_type.strip():
            p = policy_type.strip().lower()
            rows = [r for r in rows if p in (r.get("type") or "").lower()]
        for r in rows:
            if r.get("content") and len(r["content"]) > 1500:
                r["content"] = r["content"][:1500] + "…"
        return _render("live", "policies", rows, result.get("narration") or "")
    except Exception as e:  # noqa: BLE001
        rows = _SAMPLE_POLICIES
        if policy_type.strip():
            p = policy_type.strip().lower()
            rows = [r for r in rows if p in r["type"].lower()]
        return _render("sample", "policies", rows, _sample_note(e))


@tool("marketplace_order_status")
def marketplace_order_status(order_id: str) -> str:
    """Look up one marketplace order by id: order, payment and shipping status,
    amount, items and remarks. Buyer orders require a marketplace token to be
    configured; without one this returns clearly-labelled sample orders."""
    order_id = order_id.strip()
    if not order_id:
        return _render("live", "orders", [], "order_id is required")
    if not os.environ.get("MARKETPLACE_GRAPHQL_TOKEN", "").strip():
        return _render("sample", "orders", _sample_orders(order_id),
                       "Buyer order lookup needs MARKETPLACE_GRAPHQL_TOKEN; showing sample data.")
    try:
        if not _live_enabled():
            raise RuntimeError("sample mode")
        data = _execute(_ORDER_QUERY, {"input": {"orderId": order_id, "metadata": _METADATA}})
        result = data.get("getOrderById") or {}
        return _render("live", "orders", result.get("orders") or [],
                       result.get("narration") or "")
    except Exception as e:  # noqa: BLE001
        return _render("sample", "orders", _sample_orders(order_id), _sample_note(e))


def _sample_orders(order_id: str) -> list[dict[str, Any]]:
    oid = order_id.lower()
    rows = [o for o in _SAMPLE_ORDERS if o["orderId"].lower() == oid]
    return rows or _SAMPLE_ORDERS
