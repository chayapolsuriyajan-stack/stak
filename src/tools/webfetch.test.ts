import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { htmlToText, webfetchTool } from "./webfetch.js";

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(`<!doctype html>
<html><head><title>Docs</title>
<style>body { color: red }</style>
<script>console.log("evil")</script>
</head>
<body>
<!-- a build comment -->
<h1>Getting Started</h1>
<p>Install the &amp; run it.</p>
<ul><li>first item</li><li>second item</li></ul>
<a href="https://example.com/next">Next page</a>
<br/>tail line
</body></html>`);
      return;
    }
    if (url === "/plain") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("just plain text");
      return;
    }
    if (url === "/binary") {
      res.writeHead(200, { "Content-Type": "image/png" });
      res.end(Buffer.from([0x89, 0x50]));
      return;
    }
    if (url === "/big") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("x".repeat(100_000));
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("nope");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const ctx = { cwd: process.cwd() };

describe("htmlToText", () => {
  test("drops script and style content entirely", () => {
    const text = htmlToText(
      "<style>.x{}</style><script>alert(1)</script><p>visible</p>",
    );
    expect(text).toContain("visible");
    expect(text).not.toContain("alert");
    expect(text).not.toContain(".x{}");
  });

  test("keeps anchors as [text](href)", () => {
    const text = htmlToText('<a href="https://a.b">link words</a>');
    expect(text).toContain("[link words](https://a.b)");
  });

  test("decodes named and numeric entities", () => {
    const text = htmlToText("<p>a &amp; b &#39;c&#39; &lt;d&gt;</p>");
    expect(text).toContain("a & b 'c' <d>");
  });

  test("block tags become line boundaries and headings gain markers", () => {
    const text = htmlToText("<h2>A</h2><p>B</p><li>C</li>");
    const lines = text.split("\n").filter((line) => line !== "");
    expect(lines).toEqual(["## A", "B", "C"]);
  });
});

describe("webfetchTool", () => {
  test("fetches an HTML page and reduces it to readable text", async () => {
    const result = await webfetchTool.execute({ url: `${baseUrl}/html` }, ctx);

    expect(result.isError ?? false).toBe(false);
    expect(result.output).toContain("# Getting Started");
    expect(result.output).toContain("Install the & run it.");
    expect(result.output).toContain("first item");
    expect(result.output).toContain("[Next page](https://example.com/next)");
    expect(result.output).not.toContain("console.log");
    expect(result.output).not.toContain("build comment");
  });

  test("accepts plain-text responses untouched", async () => {
    const result = await webfetchTool.execute({ url: `${baseUrl}/plain` }, ctx);
    expect(result.output).toBe("just plain text");
  });

  test("rejects non-text content types", async () => {
    const result = await webfetchTool.execute({ url: `${baseUrl}/binary` }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("content-type");
  });

  test("rejects non-http protocols without fetching", async () => {
    for (const url of ["ftp://example.com/x", "file:///etc/hosts"]) {
      const result = await webfetchTool.execute({ url }, ctx);
      expect(result.isError).toBe(true);
      expect(result.output).toContain("http");
    }
  });

  test("reports HTTP errors as tool errors", async () => {
    const result = await webfetchTool.execute({ url: `${baseUrl}/missing` }, ctx);
    expect(result.isError).toBe(true);
    expect(result.output).toContain("404");
  });

  test("truncates long output with a footer", async () => {
    const result = await webfetchTool.execute(
      { url: `${baseUrl}/big`, maxChars: 100 },
      ctx,
    );
    expect((result.output as string).startsWith("x")).toBe(true);
    expect(result.output?.length).toBeLessThan(200);
    expect(result.output).toContain("truncated at 100 characters");
  });

  test("is usable in plan mode (read-only tier)", async () => {
    expect(webfetchTool.riskTier).toBe("read-only");
  });
});
