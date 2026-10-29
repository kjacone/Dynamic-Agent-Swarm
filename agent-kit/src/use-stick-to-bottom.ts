"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/** Keeps a scroller pinned to the bottom while content grows, unless the reader scrolled up. */
export function useStickToBottom() {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [isAtBottom, setAtBottom] = useState(true);

  const scrollToBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      pinned.current = atBottom;
      setAtBottom(atBottom);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
      ro.observe(content);
    }
    return () => { el.removeEventListener("scroll", onScroll); ro?.disconnect(); };
  }, []);

  return { scrollRef, contentRef, isAtBottom, scrollToBottom };
}
