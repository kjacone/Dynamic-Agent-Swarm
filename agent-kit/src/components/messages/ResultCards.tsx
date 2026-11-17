"use client";
import { useState } from "react";
import { KeyValueTable } from "../ui/KeyValueTable";

const LIST_KEYS = ["items", "results", "data", "rows", "records", "list"];

/** Arrays, or the first array under a common collection key. */
export function listItems(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const key of LIST_KEYS) {
      const v = (value as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v;
    }
  }
  return null;
}

function textOf(v: unknown): string {
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function pick(obj: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const t = textOf(obj[k]);
    if (t) return t;
  }
  return "";
}

const IMAGE_KEYS = ["image", "image_url", "imageUrl", "thumbnail", "thumbnail_url", "thumbnailUrl", "photo", "avatar", "img"];

export function imageOf(obj: Record<string, unknown>): string {
  for (const k of IMAGE_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && /^(https?:\/\/|data:image\/)/.test(v)) return v;
  }
  return "";
}

export function priceOf(obj: Record<string, unknown>): string {
  const raw = obj.price ?? obj.amount ?? obj.cost;
  if (typeof raw === "number") {
    const cur = textOf(obj.currency);
    return cur ? `${cur} ${raw.toLocaleString()}` : raw.toLocaleString();
  }
  return textOf(raw) || pick(obj, ["price_formatted", "amount_formatted", "formatted_price"]);
}

function subtitleOf(obj: Record<string, unknown>): string {
  const parts = [
    pick(obj, ["brand"]),
    pick(obj, ["category", "type"]),
    pick(obj, ["subtitle", "description", "status"]),
  ];
  return parts.filter((v, i) => v && parts.indexOf(v) === i).join(" · ");
}

/**
 * Any tool result shaped like a list renders as a horizontal card strip; cards
 * with images show them, and clicking one reveals the item's fields.
 */
export function ResultCards({ value, title }: { value: unknown; title?: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const items = listItems(value) ?? [];
  if (!items.length) return null;

  const shown = items.slice(0, 24);
  const heading = title
    || (value && typeof value === "object" ? pick(value as Record<string, unknown>, ["title", "label", "heading"]) : "")
    || "Results";
  const detail = selected != null ? shown[selected] : null;
  const detailObj = detail && typeof detail === "object" ? detail as Record<string, unknown> : null;

  return (
    <div className="lgk-results">
      <div className="lgk-results-head">
        <span>{heading}</span>
        <span className="lgk-muted">{items.length} item{items.length === 1 ? "" : "s"}</span>
      </div>
      <div className="lgk-results-cards" aria-label={heading}>
        {shown.map((item, i) => {
          const obj = item && typeof item === "object" ? item as Record<string, unknown> : null;
          const name = obj ? pick(obj, ["name", "title", "label", "subject", "id"]) : textOf(item);
          const sub = obj ? subtitleOf(obj) : "";
          const img = obj ? imageOf(obj) : "";
          const price = obj ? priceOf(obj) : "";
          const clickable = !!obj && Object.keys(obj).length > 0;
          return (
            <button
              key={i} type="button" className="lgk-r-card" disabled={!clickable}
              data-open={selected === i || undefined}
              title={name ? `View ${name}` : "View item"}
              onClick={() => clickable && setSelected(selected === i ? null : i)}
            >
              {img ? <img className="lgk-r-img" src={img} alt="" loading="lazy" /> : null}
              <span className="lgk-r-b">{name || `Item ${i + 1}`}</span>
              {sub ? <span className="lgk-r-s">{sub}</span> : null}
              {price ? <span className="lgk-r-p">{price}</span> : null}
            </button>
          );
        })}
      </div>
      {detailObj ? (
        <div className="lgk-results-detail">
          <div className="lgk-results-detail-head">
            <strong>{pick(detailObj, ["name", "title", "label"]) || "Details"}</strong>
            <button type="button" className="lgk-more" onClick={() => setSelected(null)}>Close</button>
          </div>
          <KeyValueTable data={detailObj} />
        </div>
      ) : null}
    </div>
  );
}
