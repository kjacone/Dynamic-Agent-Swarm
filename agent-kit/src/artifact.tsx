"use client";
/**
 * Artifacts: a side panel any message component can fill via a portal.
 *
 *   const [Artifact, { open, setOpen }] = useArtifact();
 *   <button onClick={() => setOpen(!open)}>Open</button>
 *   <Artifact title="Report">…content shown in the side panel…</Artifact>
 *
 * `setContext` lets an artifact attach extra context that is sent with the next message.
 */
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type HTMLAttributes, type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type Setter<T> = (value: T | ((value: T) => T)) => void;
type Slot<T> = [T, Setter<T>];

const SlotCtx = createContext<{
  open: Slot<string | null>;
  mounted: Slot<string | null>;
  title: Slot<HTMLElement | null>;
  content: Slot<HTMLElement | null>;
  context: Slot<Record<string, unknown>>;
} | null>(null);

function useSlots() {
  const v = useContext(SlotCtx);
  if (!v) throw new Error("langgraph-kit: artifacts need <LangGraphKitProvider>");
  return v;
}

export function ArtifactProvider({ children }: { children?: ReactNode }) {
  const open = useState<string | null>(null);
  const mounted = useState<string | null>(null);
  const title = useState<HTMLElement | null>(null);
  const content = useState<HTMLElement | null>(null);
  const context = useState<Record<string, unknown>>({});
  return <SlotCtx.Provider value={{ open, mounted, title, content, context }}>{children}</SlotCtx.Provider>;
}

function ArtifactSlot({ id, title, children }: { id: string; title?: ReactNode; children?: ReactNode }) {
  const s = useSlots();
  const [mountedId, setMounted] = s.mounted;
  const [contentEl] = s.content;
  const [titleEl] = s.title;
  const empty = children == null && title == null;
  useEffect(() => {
    if (empty) setMounted((cur) => (cur === id ? null : cur));
  }, [empty, id, setMounted]);
  if (mountedId !== id) return null;
  return (
    <>
      {titleEl ? createPortal(<>{title}</>, titleEl) : null}
      {contentEl ? createPortal(<>{children}</>, contentEl) : null}
    </>
  );
}

/** Where the artifact body is drawn. Render it inside your side panel. */
export function ArtifactContent(props: HTMLAttributes<HTMLDivElement>) {
  const s = useSlots();
  const [mounted] = s.mounted;
  const [, setEl] = s.content;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => setEl(mounted ? ref.current : null), [mounted, setEl]);
  if (!mounted) return null;
  return <div {...props} ref={ref} />;
}

export function ArtifactTitle(props: HTMLAttributes<HTMLDivElement>) {
  const s = useSlots();
  const [, setEl] = s.title;
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => setEl(ref.current), [setEl]);
  return <div {...props} ref={ref} />;
}

export function useArtifact() {
  const id = useId();
  const s = useSlots();
  const [openId, setOpenId] = s.open;
  const [context, setContext] = s.context;
  const [, setMounted] = s.mounted;
  const open = openId === id;
  const setOpen = useCallback((value: boolean | ((v: boolean) => boolean)) => {
    if (typeof value === "boolean") setOpenId(value ? id : null);
    else setOpenId((cur) => (cur === id ? null : id));
    setMounted(id);
  }, [id, setOpenId, setMounted]);
  const Artifact = useCallback(
    (props: { title?: ReactNode; children: ReactNode }) => <ArtifactSlot id={id} title={props.title}>{props.children}</ArtifactSlot>,
    [id],
  );
  return [Artifact, { open, setOpen, context, setContext }] as const;
}

/** `[isAnyOpen, close]` */
export function useArtifactOpen() {
  const [openId, setOpenId] = useSlots().open;
  const close = useCallback(() => setOpenId(null), [setOpenId]);
  return [openId !== null, close] as const;
}

/** Context artifacts attached; sent along with the next message. */
export function useArtifactContext() {
  return useSlots().context;
}
