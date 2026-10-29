import { blockDataUrl, blockName, type MultimodalBlock } from "../lib/multimodal";
import { FileIcon, XIcon } from "./ui/icons";

/** Thumbnail for an attached image, or a chip for a PDF. */
export function MultimodalPreview({ block, onRemove, size = "md" }: {
  block: MultimodalBlock; onRemove?: () => void; size?: "sm" | "md" | "lg";
}) {
  const name = blockName(block);
  return (
    <div className="lgk-attachment" data-size={size} data-kind={block.type === "image" ? "image" : "file"}>
      {block.type === "image" || block.mimeType.startsWith("image/")
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={blockDataUrl(block)} alt={name} />
        : <><FileIcon /><span>{name}</span></>}
      {onRemove && (
        <button type="button" className="lgk-attachment-remove" onClick={onRemove} aria-label={`Remove ${name}`} title="Remove">
          <XIcon />
        </button>
      )}
    </div>
  );
}

export function ContentBlocksPreview({ blocks, onRemove }: { blocks: MultimodalBlock[]; onRemove?: (index: number) => void }) {
  if (!blocks.length) return null;
  return (
    <div className="lgk-attachments">
      {blocks.map((b, i) => (
        <MultimodalPreview key={`${blockName(b)}-${i}`} block={b} size="md" onRemove={onRemove ? () => onRemove(i) : undefined} />
      ))}
    </div>
  );
}
