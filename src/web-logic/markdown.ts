export type Inline =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

export type Block =
  | { type: "p"; inlines: Inline[] }
  | { type: "ul"; items: Inline[][] };

function parseInlines(input: string): Inline[] {
  const out: Inline[] = [];
  let index = 0;
  let buffer = "";
  const flush = () => {
    if (!buffer) {
      return;
    }
    out.push({ type: "text", text: buffer });
    buffer = "";
  };
  while (index < input.length) {
    if (input.startsWith("**", index)) {
      const end = input.indexOf("**", index + 2);
      if (end > index + 2) {
        flush();
        out.push({ type: "strong", text: input.slice(index + 2, end) });
        index = end + 2;
        continue;
      }
    }
    if (input[index] === "`") {
      const end = input.indexOf("`", index + 1);
      if (end > index) {
        flush();
        out.push({ type: "code", text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    if (input[index] === "[") {
      const close = input.indexOf("]", index + 1);
      if (close > index && input[close + 1] === "(") {
        const hrefEnd = input.indexOf(")", close + 2);
        const href = hrefEnd > close ? input.slice(close + 2, hrefEnd).trim() : "";
        if (hrefEnd > close && /^https?:\/\//i.test(href)) {
          flush();
          out.push({ type: "link", text: input.slice(index + 1, close), href });
          index = hrefEnd + 1;
          continue;
        }
      }
    }
    if (input[index] === "*" && input[index + 1] !== "*") {
      const end = input.indexOf("*", index + 1);
      if (end > index + 1) {
        flush();
        out.push({ type: "em", text: input.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    buffer += input[index];
    index += 1;
  }
  flush();
  return out;
}

/** Small markdown subset. Raw HTML stays text, so it cannot run as markup. */
export function parseMarkdown(source: string): Block[] {
  const blocks = source.replaceAll("\r\n", "\n").split(/\n{2,}/);
  const out: Block[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.every((line) => line.trim() === "")) {
      continue;
    }
    if (lines.every((line) => /^\s*[-*] /.test(line) || line.trim() === "")) {
      out.push({
        type: "ul",
        items: lines
          .filter((line) => /^\s*[-*] /.test(line))
          .map((line) => parseInlines(line.replace(/^\s*[-*] /, ""))),
      });
      continue;
    }
    out.push({ type: "p", inlines: parseInlines(lines.join("\n")) });
  }
  return out;
}
