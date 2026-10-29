"use client";
import { Children, memo, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CheckIcon, CopyIcon } from "./ui/icons";
import { IconButton } from "./ui/IconButton";

export interface MarkdownOptions {
  /** e.g. `[remarkMath]`, added after GitHub-flavoured markdown. */
  remarkPlugins?: Options["remarkPlugins"];
  /** e.g. `[rehypeKatex]` (also import katex's CSS). */
  rehypePlugins?: Options["rehypePlugins"];
  /** Override any element renderer, including `pre` to plug in a syntax highlighter. */
  components?: Options["components"];
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const child = Children.toArray(children)[0];
  let language = "";
  let code = "";
  if (isValidElement(child)) {
    const el = child as ReactElement<{ className?: string; children?: ReactNode }>;
    language = /language-([\w-]+)/.exec(el.props.className ?? "")?.[1] ?? "";
    code = String(el.props.children ?? "").replace(/\n$/, "");
  }
  const copy = () => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <div className="lgk-codeblock">
      <div className="lgk-codeblock-head">
        <span>{language || "text"}</span>
        <IconButton label={copied ? "Copied" : "Copy code"} onClick={copy}>{copied ? <CheckIcon /> : <CopyIcon />}</IconButton>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

const base: NonNullable<Options["components"]> = {
  pre: ({ children }: any) => <CodeBlock>{children}</CodeBlock>,
  a: ({ node: _n, ...props }: any) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  table: ({ node: _n, ...props }: any) => <div className="lgk-table-wrap"><table {...props} /></div>,
};

export const Markdown = memo(function Markdown({ children, remarkPlugins = [], rehypePlugins, components }: MarkdownOptions & { children: string }) {
  return (
    <div className="lgk-md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, ...(remarkPlugins ?? [])]}
        rehypePlugins={rehypePlugins}
        components={{ ...base, ...components }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
});
