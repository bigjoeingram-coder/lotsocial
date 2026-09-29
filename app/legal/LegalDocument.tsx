import type { ReactNode } from "react";
import Link from "next/link";
import type { LegalDocument as LegalDocumentRecord } from "./generated-content";

type Block =
  | { type: "heading"; value: string }
  | { type: "paragraph"; value: string }
  | { type: "ul" | "ol"; values: string[] };

function parseBlocks(body: string) {
  const lines = body.split(/\r?\n/);
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Extract<Block, { type: "ul" | "ol" }> | null = null;

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", value: paragraph.join(" ").trim() });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "heading", value: line.slice(3).trim() });
      continue;
    }
    const unordered = line.match(/^-\s+(.+)$/);
    const ordered = line.match(/^\d+\.\s+(.+)$/);
    if (unordered || ordered) {
      flushParagraph();
      const type = unordered ? "ul" : "ol";
      if (!list || list.type !== type) {
        flushList();
        list = { type, values: [] };
      }
      list.values.push((unordered ?? ordered)?.[1] ?? "");
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

function renderInline(value: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /\[([^\]]+)]\(([^)]+)\)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    if (match.index > cursor) nodes.push(value.slice(cursor, match.index));
    const [, label, href] = match;
    nodes.push(href.startsWith("/")
      ? <Link key={`${keyPrefix}-${match.index}`} href={href}>{label}</Link>
      : <a key={`${keyPrefix}-${match.index}`} href={href} target="_blank" rel="noreferrer">{label} <span aria-hidden="true">↗</span></a>);
    cursor = match.index + match[0].length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

export function LegalDocument({ document }: { document: LegalDocumentRecord }) {
  return <>{parseBlocks(document.body).map((block, index) => {
    const key = `${document.id}-${index}`;
    if (block.type === "heading") return <h2 key={key}>{block.value}</h2>;
    if (block.type === "paragraph") return <p key={key}>{renderInline(block.value, key)}</p>;
    const List = block.type;
    return <List key={key}>{block.values.map((value, itemIndex) => <li key={`${key}-${itemIndex}`}>{renderInline(value, `${key}-${itemIndex}`)}</li>)}</List>;
  })}</>;
}
