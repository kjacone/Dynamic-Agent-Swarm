/** Image / PDF blocks in LangChain's standard content-block shape (base64, no data: prefix). */
export type ImageBlock = { type: "image"; mimeType: string; data: string; metadata?: { name?: string } };
export type FileBlock = { type: "file"; mimeType: "application/pdf"; data: string; metadata?: { filename?: string; name?: string } };
export type MultimodalBlock = ImageBlock | FileBlock;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
export const SUPPORTED_FILE_TYPES = [...IMAGE_TYPES, "application/pdf"];
export const ACCEPT_ATTR = SUPPORTED_FILE_TYPES.join(",");

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

export async function fileToContentBlock(file: File): Promise<MultimodalBlock> {
  if (!SUPPORTED_FILE_TYPES.includes(file.type)) throw new Error(`Unsupported file type: ${file.type || "unknown"}`);
  const data = await fileToBase64(file);
  if (IMAGE_TYPES.includes(file.type)) return { type: "image", mimeType: file.type, data, metadata: { name: file.name } };
  return { type: "file", mimeType: "application/pdf", data, metadata: { filename: file.name } };
}

export function isMultimodalBlock(block: unknown): block is MultimodalBlock {
  if (typeof block !== "object" || block === null) return false;
  const b = block as { type?: unknown; mimeType?: unknown };
  if (typeof b.mimeType !== "string") return false;
  if (b.type === "image") return b.mimeType.startsWith("image/");
  // legacy: images were sometimes sent as type "file"
  if (b.type === "file") return b.mimeType.startsWith("image/") || b.mimeType === "application/pdf";
  return false;
}

export const blockDataUrl = (b: MultimodalBlock) => `data:${b.mimeType};base64,${b.data}`;
export const blockName = (b: MultimodalBlock) =>
  String((b.metadata as { name?: string; filename?: string } | undefined)?.filename ??
    (b.metadata as { name?: string } | undefined)?.name ?? (b.type === "image" ? "image" : "PDF file"));
