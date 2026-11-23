// Drafts the covering email for a set of leadership minutes.
//
// Nothing here sends anything. It turns the minutes on screen into a
// subject line and a plain-text body, and the page offers them as a
// mailto: draft and as text to copy. The chair reviews and sends it from
// their own mail app.

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-11-23-kick-off-meeting" -> "23 November 2026" ("" when there is no date). */
export function dateOfId(id: string): string {
  const m = id.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  const month = MONTHS[parseInt(m[2], 10) - 1];
  return month ? `${parseInt(m[3], 10)} ${month} ${m[1]}` : "";
}

const clean = (s: string | null | undefined) => (s || "").replace(/\s+/g, " ").trim();

/** Rows of the table that follows the "Actions" heading: [action, owner]. */
function actions(body: Element): { text: string; owner: string }[] {
  const heading = Array.from(body.querySelectorAll("h2")).find((h) => /^actions?$/i.test(clean(h.textContent)));
  let table: Element | null = null;
  for (let el = heading?.nextElementSibling ?? null; el; el = el.nextElementSibling) {
    if (el.tagName === "TABLE") { table = el; break; }
    if (el.tagName === "H2") break;
  }
  if (!table) return [];
  const head = Array.from(table.querySelectorAll("thead th")).map((th) => clean(th.textContent).toLowerCase());
  const iAction = head.indexOf("action");
  const iOwner = head.indexOf("owner");
  if (iAction < 0) return [];
  return Array.from(table.querySelectorAll("tbody tr"))
    .map((tr) => {
      const cells = Array.from(tr.children);
      return { text: clean(cells[iAction]?.textContent), owner: iOwner >= 0 ? clean(cells[iOwner]?.textContent) : "" };
    })
    .filter((a) => a.text);
}

/** The minutes as plain text, section by section, without the Actions table. */
function fullText(body: Element): string[] {
  const out: string[] = [];
  const list = (el: Element, depth: number) => {
    Array.from(el.children).forEach((li, i) => {
      if (li.tagName !== "LI") return;
      const own = Array.from(li.childNodes)
        .filter((n) => !(n.nodeType === 1 && /^(UL|OL)$/.test((n as Element).tagName)))
        .map((n) => n.textContent || "")
        .join("");
      out.push(`${"  ".repeat(depth)}${el.tagName === "OL" ? `${i + 1}.` : "-"} ${clean(own)}`);
      Array.from(li.children).forEach((c) => { if (/^(UL|OL)$/.test(c.tagName)) list(c, depth + 1); });
    });
  };
  let skipping = false;
  Array.from(body.children).forEach((el) => {
    const tag = el.tagName;
    if (tag === "H1") return;
    if (tag === "H2") {
      skipping = /^actions?$/i.test(clean(el.textContent));
      if (!skipping) out.push("", clean(el.textContent).toUpperCase());
      return;
    }
    if (skipping) return;
    if (tag === "P") {
      if (!el.classList.contains("meta")) out.push("", clean(el.textContent));
    } else if (tag === "DL") {
      Array.from(el.children).forEach((c, i, all) => {
        if (c.tagName === "DT") out.push(`${clean(c.textContent)}: ${all[i + 1]?.tagName === "DD" ? clean(all[i + 1].textContent) : ""}`);
      });
    } else if (tag === "UL" || tag === "OL") {
      list(el, 0);
    } else if (tag === "H3") {
      out.push("", clean(el.textContent));
    }
  });
  return out;
}

export interface EmailDraftOptions {
  /** File-name stem of the minutes, e.g. "2026-11-23-kick-off-meeting". */
  id: string;
  /** Who signs the email. */
  sender: string;
  /** Link to the minutes on the members site. */
  pageUrl: string;
  /** Append the minutes themselves, not only the actions. */
  full: boolean;
}

export function buildEmailDraft(body: Element, opts: EmailDraftOptions): { subject: string; body: string } {
  const title = clean(body.querySelector("h1")?.textContent) || "AsPEN leadership meeting";
  const date = dateOfId(opts.id);
  const acts = actions(body);

  const lines: string[] = [
    "Dear all,",
    "",
    `Please find the minutes of the ${title}${date ? ` (${date})` : ""} on the AsPEN members site:`,
    opts.pageUrl,
    "The page needs your AsPEN sign-in and has a Word download.",
  ];
  if (acts.length) {
    lines.push("", "ACTIONS");
    acts.forEach((a, i) => lines.push(`${i + 1}. ${a.text}${a.owner ? ` (${a.owner})` : ""}`));
  }
  if (opts.full) {
    lines.push("", "MINUTES");
    lines.push(...fullText(body));
  }
  lines.push("", "Please let me know of any corrections.", "", "Best regards,", opts.sender || "");

  return {
    subject: `Minutes: ${title}${date ? `, ${date}` : ""}`,
    body: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n",
  };
}

/** A Gmail compose link for the draft. It takes far longer drafts than mailto: does. */
export function gmailHref(to: string[], subject: string, body: string): string {
  const enc = encodeURIComponent;
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(to.join(","))}&su=${enc(subject)}&body=${enc(body)}`;
}

/** A mailto: link for the draft. Line breaks go as CRLF, as RFC 6068 asks. */
export function mailtoHref(to: string[], subject: string, body: string): string {
  const enc = (s: string) => encodeURIComponent(s.replace(/\r?\n/g, "\r\n"));
  return `mailto:${to.map((a) => encodeURIComponent(a).replace(/%40/g, "@")).join(",")}?subject=${enc(subject)}&body=${enc(body)}`;
}
