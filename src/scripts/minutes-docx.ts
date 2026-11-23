// Turns the minutes shown on /members/leadership into a Word file.
//
// The minutes are a small HTML fragment (h1, p, h2, ul/ol, dl, table). This
// walks that fragment and rebuilds it with the `docx` library, under an
// AsPEN letterhead. Loaded on demand, only when the button is clicked.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  ImageRun,
  LevelFormat,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopType,
  TextRun,
  VerticalAlign,
  WidthType,
} from "docx";

const BRAND = "21443E"; // brand-700
const BRAND_LINE = "3D736A"; // brand-500
const INK = "1E293B";
const MUTED = "64748B";
const RULE = "CBD5E1";
const HEAD_FILL = "F1F5F9";

// A4 with 2 cm side margins: the usable width in twips.
const PAGE_W = 11906;
const MARGIN_X = 1134;
const CONTENT_W = PAGE_W - MARGIN_X * 2;

type Fmt = { bold?: boolean; italics?: boolean; color?: string; size?: number };

/** Inline content of `el` as runs. Nested lists are skipped: the caller handles them. */
function runs(el: Node, fmt: Fmt = {}): TextRun[] {
  const out: TextRun[] = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) {
      const text = (n.textContent || "").replace(/\s+/g, " ");
      if (text) out.push(new TextRun({ text, ...fmt }));
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const e = n as Element;
    const tag = e.tagName;
    if (tag === "UL" || tag === "OL") return;
    if (tag === "BR") { out.push(new TextRun({ break: 1, ...fmt })); return; }
    if (tag === "STRONG" || tag === "B") { out.push(...runs(e, { ...fmt, bold: true })); return; }
    if (tag === "EM" || tag === "I") { out.push(...runs(e, { ...fmt, italics: true })); return; }
    out.push(...runs(e, fmt));
  });
  // Trim the outer whitespace the HTML indentation leaves behind.
  return out;
}

function trimmed(el: Node, fmt: Fmt = {}): TextRun[] {
  const clone = el.cloneNode(true) as Element;
  const first = firstText(clone);
  if (first) first.textContent = (first.textContent || "").replace(/^\s+/, "");
  const last = lastText(clone);
  if (last) last.textContent = (last.textContent || "").replace(/\s+$/, "");
  return runs(clone, fmt);
}
function firstText(n: Node): Text | null {
  for (const c of Array.from(n.childNodes)) {
    if (c.nodeType === Node.TEXT_NODE) return c as Text;
    if (c.nodeType === Node.ELEMENT_NODE && !/^(UL|OL)$/.test((c as Element).tagName)) {
      const t = firstText(c);
      if (t) return t;
    }
  }
  return null;
}
function lastText(n: Node): Text | null {
  for (const c of Array.from(n.childNodes).reverse()) {
    if (c.nodeType === Node.ELEMENT_NODE && /^(UL|OL)$/.test((c as Element).tagName)) continue;
    if (c.nodeType === Node.TEXT_NODE) {
      if ((c.textContent || "").trim()) return c as Text;
      continue;
    }
    if (c.nodeType === Node.ELEMENT_NODE) {
      const t = lastText(c);
      if (t) return t;
    }
  }
  return null;
}

let listInstance = 0;

function list(el: Element, level: number, instance: number): Paragraph[] {
  const ordered = el.tagName === "OL";
  const out: Paragraph[] = [];
  Array.from(el.children).forEach((li) => {
    if (li.tagName !== "LI") return;
    out.push(new Paragraph({
      children: trimmed(li),
      numbering: { reference: ordered ? "numbers" : "bullets", level: Math.min(level, 2), instance },
      spacing: { after: 80 },
    }));
    Array.from(li.children).forEach((c) => {
      if (c.tagName === "UL" || c.tagName === "OL") out.push(...list(c, level + 1, c.tagName === "OL" ? ++listInstance : instance));
    });
  });
  return out;
}

function definitionList(el: Element): Paragraph[] {
  const out: Paragraph[] = [];
  const kids = Array.from(el.children);
  for (let i = 0; i < kids.length; i++) {
    if (kids[i].tagName !== "DT") continue;
    const dd = kids[i + 1] && kids[i + 1].tagName === "DD" ? kids[i + 1] : null;
    out.push(new Paragraph({
      children: [
        ...trimmed(kids[i], { bold: true, color: INK }),
        new TextRun({ text: "\t" }),
        ...(dd ? trimmed(dd) : []),
      ],
      tabStops: [{ type: TabStopType.LEFT, position: 2000 }],
      indent: { left: 2000, hanging: 2000 },
      spacing: { after: 60 },
    }));
  }
  return out;
}

function table(el: Element): Table {
  const rows = Array.from(el.querySelectorAll("tr"));
  const cols = Math.max(1, ...rows.map((r) => r.children.length));
  const headFirst = (rows[0]?.children[0]?.textContent || "").trim();
  // A leading "#" column stays narrow; a short last column (owner, date) gets a fixed share.
  let shares: number[];
  if (headFirst === "#" && cols === 3) shares = [0.06, 0.66, 0.28];
  else if (headFirst === "#" && cols > 3) shares = [0.06, ...Array(cols - 1).fill(0.94 / (cols - 1))];
  else shares = Array(cols).fill(1 / cols);
  const widths = shares.map((s) => Math.round(CONTENT_W * s));
  const line = { style: BorderStyle.SINGLE, size: 4, color: RULE };
  const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

  return new Table({
    width: { size: CONTENT_W, type: WidthType.DXA },
    columnWidths: widths,
    rows: rows.map((r) => {
      const isHead = Array.from(r.children).every((c) => c.tagName === "TH");
      return new TableRow({
        tableHeader: isHead,
        cantSplit: true,
        children: Array.from(r.children).map((c, i) => new TableCell({
          width: { size: widths[i] ?? widths[widths.length - 1], type: WidthType.DXA },
          verticalAlign: VerticalAlign.TOP,
          margins: { top: 70, bottom: 70, left: 100, right: 100 },
          shading: isHead ? { type: ShadingType.CLEAR, color: "auto", fill: HEAD_FILL } : undefined,
          borders: { top: isHead ? line : none, bottom: line, left: none, right: none },
          children: [new Paragraph({
            children: trimmed(c, isHead ? { bold: true, size: 18, color: MUTED } : { size: 20 }),
            spacing: { after: 0 },
          })],
        })),
      });
    }),
  });
}

function blocks(root: Element): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = [];
  Array.from(root.children).forEach((el) => {
    switch (el.tagName) {
      case "H1":
        out.push(new Paragraph({
          children: trimmed(el, { bold: true, size: 36, color: BRAND }),
          spacing: { before: 120, after: 60 },
        }));
        break;
      case "H2":
        out.push(new Paragraph({
          children: trimmed(el, { bold: true, size: 26, color: BRAND }),
          spacing: { before: 320, after: 120 },
          keepNext: true,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 3 } },
        }));
        break;
      case "H3":
        out.push(new Paragraph({
          children: trimmed(el, { bold: true, size: 22, color: INK }),
          spacing: { before: 200, after: 80 },
          keepNext: true,
        }));
        break;
      case "P":
        out.push(new Paragraph({
          children: el.classList.contains("meta") ? trimmed(el, { color: MUTED, size: 20 }) : trimmed(el),
          spacing: { after: el.classList.contains("meta") ? 160 : 120 },
        }));
        break;
      case "UL":
      case "OL":
        out.push(...list(el, 0, ++listInstance));
        break;
      case "DL":
        out.push(...definitionList(el));
        out.push(new Paragraph({ children: [], spacing: { after: 60 } }));
        break;
      case "TABLE":
        out.push(table(el));
        out.push(new Paragraph({ children: [], spacing: { after: 60 } }));
        break;
      default:
        out.push(...blocks(el));
    }
  });
  return out;
}

export interface MinutesExport {
  /** File-name stem, e.g. "2026-11-23-kick-off-meeting". */
  id: string;
  /** Absolute or root-relative URL of the AsPEN mark (PNG). */
  logoUrl: string;
}

export async function buildMinutesDocx(body: Element, opts: MinutesExport): Promise<Blob> {
  listInstance = 0;
  const title = (body.querySelector("h1")?.textContent || "AsPEN leadership meeting").trim();

  let logo: ArrayBuffer | null = null;
  try {
    const r = await fetch(opts.logoUrl);
    if (r.ok) logo = await r.arrayBuffer();
  } catch { /* the document is still useful without the mark */ }

  // The mark is 354 x 387 px; keep that ratio.
  const header = new Header({
    children: [new Paragraph({
      children: [
        ...(logo ? [new ImageRun({ type: "png", data: logo, transformation: { width: 46, height: 50 } })] : []),
        new TextRun({ text: "\tAsian Pharmacoepidemiology Network (AsPEN)", bold: true, size: 20, color: BRAND }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }],
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND_LINE, space: 6 } },
      spacing: { after: 0 },
    })],
  });

  const footer = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 18, color: MUTED })],
    })],
  });

  const bullet = (level: number, text: string) => ({
    level,
    format: LevelFormat.BULLET,
    text,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 420 + level * 360, hanging: 260 } } },
  });

  const doc = new Document({
    creator: "AsPEN",
    title,
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22, color: "334155" },
          paragraph: { spacing: { after: 120, line: 288 } },
        },
      },
    },
    numbering: {
      config: [
        { reference: "bullets", levels: [bullet(0, "•"), bullet(1, "–"), bullet(2, "·")] },
        {
          reference: "numbers",
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.DECIMAL,
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420 + level * 360, hanging: 300 } } },
          })),
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: PAGE_W, height: 16838 },
          margin: { top: 1900, bottom: 1300, left: MARGIN_X, right: MARGIN_X, header: 560, footer: 560 },
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children: blocks(body),
    }],
  });

  return Packer.toBlob(doc);
}

export async function exportMinutes(body: Element, opts: MinutesExport): Promise<void> {
  const blob = await buildMinutesDocx(body, opts);
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = `AsPEN-minutes-${opts.id || "leadership"}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
