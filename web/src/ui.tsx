import type { ReactNode } from "react";
import type { Inline } from "@jarvis/markdown.ts";
import { parseMarkdown } from "@jarvis/markdown.ts";

export { pulse } from "./feel.ts";

export function Lamp({ className = "" }: { className?: string }) {
  return <span className={`lamp ${className}`} aria-hidden="true" />;
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="stack" aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <div key={index} className="skel" style={{ width: `${86 - index * 14}%` }} />
      ))}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <Lamp />
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}

export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) {
    return null;
  }
  return (
    <div className="sheet-root" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sheet-bar" />
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function InlineView({ part }: { part: Inline }) {
  if (part.type === "strong") {
    return <strong>{part.text}</strong>;
  }
  if (part.type === "em") {
    return <em>{part.text}</em>;
  }
  if (part.type === "code") {
    return <code>{part.text}</code>;
  }
  if (part.type === "link") {
    return (
      <a href={part.href} target="_blank" rel="noreferrer">
        {part.text}
      </a>
    );
  }
  const lines = part.text.split("\n");
  return lines.map((line, index) => (
    <span key={`${index}-${line.slice(0, 12)}`}>
      {index > 0 ? <br /> : null}
      {line}
    </span>
  ));
}

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  if (blocks.length === 0) {
    return null;
  }
  return blocks.map((block, index) => {
    if (block.type === "ul") {
      return (
        <ul key={index}>
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>
              {item.map((part, partIndex) => (
                <InlineView key={partIndex} part={part} />
              ))}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <p key={index}>
        {block.inlines.map((part, partIndex) => (
          <InlineView key={partIndex} part={part} />
        ))}
      </p>
    );
  });
}
