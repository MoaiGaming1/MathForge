function text(value) {
  return { type: "text", value };
}

function element(tag, children = [], props = {}) {
  return { type: "element", tag, children, props };
}

function safeHref(value) {
  const href = value.trim();
  if (href.startsWith("#")) return href;
  try {
    const url = new URL(href);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function inline(source) {
  const pattern = /(\$\$[^$]+?\$\$|\$[^$\n]+?\$|`[^`\n]+`|\[[^\]]+\]\([^)]+\)|\*\*[^*]+?\*\*|__[^_]+?__|~~[^~]+?~~|(?<!\\)\*[^*\n]+?\*|(?<!\\)_[^_\n]+?_)/g;
  const result = [];
  let start = 0;
  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > start) result.push(text(source.slice(start, index)));
    const token = match[0];
    if (token.startsWith("$$")) {
      result.push({ type: "math", source: token.slice(2, -2).trim(), display: true });
    } else if (token.startsWith("$")) {
      result.push({ type: "math", source: token.slice(1, -1), display: false });
    } else if (token.startsWith("`")) {
      result.push(element("code", [text(token.slice(1, -1))]));
    } else if (token.startsWith("[")) {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = link && safeHref(link[2]);
      if (link && href) {
        const external = href.startsWith("http:") || href.startsWith("https:");
        result.push(element("a", inline(link[1]), {
          href,
          ...(external ? { target: "_blank", rel: "noreferrer noopener" } : {}),
        }));
      } else result.push(text(token));
    } else {
      const delimiter = token.startsWith("**") || token.startsWith("__") ? 2 : 1;
      const tag = token.startsWith("~~") ? "del" : token.startsWith("**") || token.startsWith("__") ? "strong" : "em";
      result.push(element(tag, inline(token.slice(delimiter, -delimiter))));
    }
    start = index + token.length;
  }
  if (start < source.length) result.push(text(source.slice(start)));
  return result;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function startsBlock(lines, index) {
  const line = lines[index] ?? "";
  return /^\s*(```|#{1,6}\s|>|(?:[-*_]\s*){3,}$|(?:[-+*]|\d+[.)])\s+)/.test(line)
    || (index + 1 < lines.length && line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1]));
}

export function parseMarkdown(source) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (/^\s*```/.test(line)) {
      const info = line.trim().slice(3).trim().split(/\s+/, 1)[0];
      index += 1;
      const content = [];
      while (index < lines.length && !/^\s*```/.test(lines[index])) content.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(element("pre", [element("code", [text(content.join("\n"))], info ? { className: `language-${info}` } : {})]));
      continue;
    }

    const displayMath = /^\s*\$\$(.*)$/.exec(line);
    if (displayMath) {
      let content = displayMath[1];
      if (content.endsWith("$$")) content = content.slice(0, -2);
      else {
        index += 1;
        const middle = [];
        while (index < lines.length && !lines[index].includes("$$")) middle.push(lines[index++]);
        if (index < lines.length) {
          const closing = lines[index].indexOf("$$");
          middle.push(lines[index].slice(0, closing));
          content += `${content ? "\n" : ""}${middle.join("\n")}`;
          index += 1;
          blocks.push({ type: "math", source: content.trim(), display: true });
          continue;
        }
        content = [content, ...middle].join("\n");
      }
      blocks.push({ type: "math", source: content.trim(), display: true });
      index += 1;
      continue;
    }

    const heading = /^\s*(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push(element(`h${heading[1].length}`, inline(heading[2])));
      index += 1;
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      blocks.push(element("hr"));
      index += 1;
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push(element("blockquote", parseMarkdown(quote.join("\n"))));
      continue;
    }

    const listMatch = /^\s*((?:[-+*])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items = [];
      while (index < lines.length) {
        const match = /^\s*((?:[-+*])|(\d+)[.)])\s+(.+)$/.exec(lines[index]);
        if (!match || Boolean(match[2]) !== ordered) break;
        items.push(element("li", inline(match[3])));
        index += 1;
      }
      blocks.push(element(ordered ? "ol" : "ul", items));
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])) {
      const headers = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index++]));
      }
      const head = element("thead", [element("tr", headers.map((cell) => element("th", inline(cell))))]);
      const body = element("tbody", rows.map((row) => element("tr", headers.map((_, column) => element("td", inline(row[column] ?? ""))))));
      blocks.push(element("table", [head, body]));
      continue;
    }

    const paragraph = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) paragraph.push(lines[index++].trim());
    blocks.push(element("p", inline(paragraph.join(" "))));
  }
  return blocks;
}
