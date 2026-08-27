import { z } from "zod";
import type { Tool } from "./types.js";

const DEFAULT_MAX_CHARS = 20_000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

const schema = z.object({
  url: z
    .string()
    .url()
    .describe("Absolute http(s) URL of the page or text resource to fetch"),
  maxChars: z
    .number()
    .int()
    .min(200)
    .max(100_000)
    .optional()
    .describe(`Output cap in characters (default ${DEFAULT_MAX_CHARS})`),
});

/** Block-level tags whose content starts on a new line. */
const BLOCK_TAGS =
  /^(address|article|blockquote|br|div|dd|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|thead|tr|td|th|ul)$/i;

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 10)),
    )
    .replace(/&x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/**
 * Reduces HTML to readable plain text without dependencies: scripts, styles,
 * and comments vanish; block boundaries become newlines; headings gain
 * markdown # markers; anchors survive as [text](href); entities decode last
 * so an encoded &lt;tag&gt; can't be mistaken for a real one.
 */
export function htmlToText(html: string): string {
  const withoutAnchors = html.replace(
    /<a\s[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, inner: string) => {
      const label = decodeEntities(stripTags(inner)).trim();
      return label === "" ? "" : `[${label}](${decodeEntities(href)})`;
    },
  );

  return decodeEntities(reduceHtml(withoutAnchors)).trim();
}

function reduceHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])(\s[^>]*)?>/gi, (_match, level: string) => {
      return `\n${"#".repeat(Number(level))} `;
    })
    .replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g, (match, tag: string) =>
      BLOCK_TAGS.test(tag) ? "\n" : "",
    )
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

export const webfetchTool: Tool<z.infer<typeof schema>> = {
  name: "webfetch",
  description:
    "Fetch a URL and return its content as readable text. Works on HTML pages (reduced to text with links preserved) and any text/* resource. Read-only; requires an exact http(s) URL — it cannot search the web.",
  // Network read: usable from plan mode, where research is the whole point.
  riskTier: "read-only",
  schema,

  async execute(args) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(args.url);
    } catch {
      return { output: `Invalid URL: ${args.url}`, isError: true };
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return {
        output: `Only http and https URLs are supported, got "${parsedUrl.protocol}".`,
        isError: true,
      };
    }

    const maxChars = args.maxChars ?? DEFAULT_MAX_CHARS;

    let response: Response;
    try {
      response = await fetch(parsedUrl.toString(), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });
    } catch (error) {
      return {
        output: `Failed to fetch ${args.url}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        isError: true,
      };
    }

    if (!response.ok) {
      return {
        output: `Request failed with HTTP ${response.status} ${response.statusText} for ${args.url}.`,
        isError: true,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.startsWith("text/")) {
      return {
        output: `Unsupported content-type "${contentType}" for ${args.url} — webfetch only handles text/html and other text/* resources.`,
        isError: true,
      };
    }

    // Cap the download before decoding so a huge body can't balloon memory.
    const reader = response.body?.getReader();
    let raw = "";
    if (reader) {
      const decoder = new TextDecoder();
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        raw += decoder.decode(value, { stream: true });
        if (received >= MAX_DOWNLOAD_BYTES) {
          await reader.cancel();
          break;
        }
      }
      raw += decoder.decode();
    }

    const isHtml = contentType.includes("text/html");
    const text = isHtml ? htmlToText(raw) : raw.trim();

    if (text.length > maxChars) {
      return {
        output: `${text.slice(0, maxChars)}\n\n… output truncated at ${maxChars} characters. Fetch again with a larger maxChars or a more specific page.`,
      };
    }
    return { output: text };
  },
};
