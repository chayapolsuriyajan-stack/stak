import dns from "node:dns/promises";
import net from "node:net";
import { z } from "zod";
import type { Tool } from "./types.js";

const DEFAULT_MAX_CHARS = 20_000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 30_000;
/** Redirects are followed by hand so every hop is re-validated; a public URL
 * that 302s to 169.254.169.254 must not slip past the first check. */
const MAX_REDIRECTS = 5;

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

/**
 * SECURITY: true when an IP belongs to a range that is only reachable from
 * inside the host or its network — loopback, RFC1918 private space, CGNAT,
 * link-local (which includes 169.254.169.254, the cloud instance-metadata
 * endpoint that hands out credentials), and their IPv6 equivalents.
 *
 * webfetch takes a model-chosen URL and is auto-approved as a read-only
 * tool, so without this check a prompt-injected model could read the host's
 * own metadata service, or port-scan an internal network, with no prompt.
 */
export function isBlockedAddress(ip: string): boolean {
  const version = net.isIP(ip);

  if (version === 4) {
    const octets = ip.split(".").map(Number);
    const [a = 0, b = 0] = octets;
    if (a === 0) return true; // 0.0.0.0/8 "this host"
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast + reserved
    return false;
  }

  if (version === 6) {
    const normalized = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (normalized === "::" || normalized === "::1") return true; // unspecified/loopback
    if (normalized.startsWith("fe80")) return true; // link-local
    if (/^f[cd]/.test(normalized)) return true; // unique local (fc00::/7)
    if (normalized.startsWith("ff")) return true; // multicast
    // ::ffff:127.0.0.1 and friends — an IPv4 address wearing an IPv6 hat.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
    if (mapped?.[1]) return isBlockedAddress(mapped[1]);
    return false;
  }

  return false;
}

/**
 * Resolves a hostname and rejects it if ANY address it maps to is internal.
 * Checking every result (rather than just the first) closes the case where a
 * hostname deliberately returns both a public and a private address.
 */
async function assertPublicHost(hostname: string): Promise<string | undefined> {
  // Opt-in escape hatch for the legitimate case this otherwise blocks:
  // pointing the model at your own dev server on localhost. Off by default
  // because turning it on re-opens the metadata-endpoint and internal-network
  // reach that the checks below exist to close.
  if (process.env["STAK_WEBFETCH_ALLOW_PRIVATE"] === "1") return undefined;

  const bare = hostname.replace(/^\[|\]$/g, "");

  if (net.isIP(bare) !== 0) {
    return isBlockedAddress(bare)
      ? `${bare} is a private or loopback address; webfetch only reaches public hosts.`
      : undefined;
  }

  if (bare.toLowerCase() === "localhost" || bare.toLowerCase().endsWith(".localhost")) {
    return `"${hostname}" resolves to the local machine; webfetch only reaches public hosts.`;
  }

  let resolved: { address: string }[];
  try {
    resolved = await dns.lookup(bare, { all: true });
  } catch (error) {
    return `Could not resolve "${hostname}": ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  for (const { address } of resolved) {
    if (isBlockedAddress(address)) {
      return `"${hostname}" resolves to ${address}, a private or loopback address; webfetch only reaches public hosts.`;
    }
  }
  return undefined;
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

    // Redirects are followed manually so each hop is validated: "follow"
    // would let a public URL bounce to an internal one behind our back.
    let response: Response;
    let currentUrl = parsedUrl;
    try {
      for (let hop = 0; ; hop++) {
        const blocked = await assertPublicHost(currentUrl.hostname);
        if (blocked) return { output: blocked, isError: true };

        response = await fetch(currentUrl.toString(), {
          signal: AbortSignal.timeout(TIMEOUT_MS),
          redirect: "manual",
        });

        const location = response.headers.get("location");
        if (response.status < 300 || response.status >= 400 || location === null) break;

        if (hop >= MAX_REDIRECTS) {
          return {
            output: `Too many redirects (more than ${MAX_REDIRECTS}) starting from ${args.url}.`,
            isError: true,
          };
        }

        const next = new URL(location, currentUrl);
        if (next.protocol !== "http:" && next.protocol !== "https:") {
          return {
            output: `Refusing to follow a redirect to a non-http(s) URL: ${next.toString()}`,
            isError: true,
          };
        }
        currentUrl = next;
      }
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
