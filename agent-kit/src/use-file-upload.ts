"use client";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent } from "react";
import { SUPPORTED_FILE_TYPES, fileToContentBlock, type MultimodalBlock } from "./lib/multimodal";

const isDuplicate = (f: File, blocks: MultimodalBlock[]) =>
  blocks.some((b) => {
    const meta = (b.metadata ?? {}) as { name?: string; filename?: string };
    return b.mimeType === f.type && (meta.filename ?? meta.name) === f.name;
  });

/** Attachments for the composer: picker, drag-and-drop anywhere on the page, and paste. */
export function useFileUpload({ enabled = true, onError }: { enabled?: boolean; onError?: (message: string) => void } = {}) {
  const [blocks, setBlocks] = useState<MultimodalBlock[]>([]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const [dragOver, setDragOver] = useState(false);
  const depth = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const addFiles = useCallback(async (files: File[]) => {
    const valid = files.filter((f) => SUPPORTED_FILE_TYPES.includes(f.type));
    if (valid.length < files.length) onErrorRef.current?.("Only JPEG, PNG, GIF, WEBP images and PDFs can be attached.");
    const fresh = valid.filter((f) => !isDuplicate(f, blocksRef.current));
    if (fresh.length < valid.length) onErrorRef.current?.("That file is already attached.");
    if (!fresh.length) return;
    try {
      const next = await Promise.all(fresh.map(fileToContentBlock));
      setBlocks((p) => [...p, ...next]);
    } catch (e) {
      onErrorRef.current?.(e instanceof Error ? e.message : "Could not read the file.");
    }
  }, []);

  const handleFileUpload = useCallback(async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    await addFiles(files);
  }, [addFiles]);

  const handlePaste = useCallback((e: ClipboardEvent) => {
    if (!enabled) return;
    const files = Array.from(e.clipboardData.items)
      .filter((i) => i.kind === "file")
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (!files.length) return;
    e.preventDefault();
    void addFiles(files);
  }, [enabled, addFiles]);

  useEffect(() => {
    if (!enabled) return;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types?.includes("Files");
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth.current += 1; setDragOver(true); } };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragOver(false);
    };
    const over = (e: DragEvent) => { if (hasFiles(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setDragOver(false);
      void addFiles(Array.from(e.dataTransfer?.files ?? []));
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [enabled, addFiles]);

  return {
    blocks, dragOver, handleFileUpload, handlePaste,
    removeBlock: (index: number) => setBlocks((p) => p.filter((_, i) => i !== index)),
    reset: () => setBlocks([]),
  };
}
