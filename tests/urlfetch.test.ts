// URL imports must not reach private or internal addresses, and must stop at the size limit.

import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { app } from "../server/app.js";
import { fetchPublicUrl, isPrivateAddress, setAllowPrivateUrls, UrlFetchError } from "../server/urlfetch.js";

let server: Server;
let site: Server;
let base: string;
let siteUrl: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  // A stand-in website: a page, a redirect, and a large download.
  site = http.createServer((req, res) => {
    if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><head><title>Report</title></head><body><main><p>Readable text.</p></main></body></html>");
    } else if (req.url === "/redirect") {
      res.writeHead(302, { location: "/page" });
      res.end();
    } else if (req.url === "/big") {
      res.writeHead(200, { "content-type": "text/plain" }); // no content-length: streamed
      for (let i = 0; i < 20; i++) res.write("x".repeat(1024));
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  site.listen(0, "127.0.0.1");
  await Promise.all([server, site].map((s) => new Promise((r) => s.once("listening", r))));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  siteUrl = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  site.close();
});
afterEach(() => setAllowPrivateUrls(false));

test("private, loopback, link-local and internal addresses are recognised", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "2606:4700::1111"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

test("POST /api/fetch-url refuses an internal address", async () => {
  for (const url of [`${siteUrl}/page`, "http://169.254.169.254/latest/meta-data/", "http://[::1]:8787/api/packs"]) {
    const res = await fetch(`${base}/api/fetch-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    assert.equal(res.status, 400, url);
    assert.match(((await res.json()) as any).error, /private or internal network/);
  }
});

test("POST /api/fetch-url rejects non-web addresses", async () => {
  const res = await fetch(`${base}/api/fetch-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "file:///etc/passwd" }),
  });
  assert.equal(res.status, 400);
});

test("redirects are followed, and each hop is checked", async () => {
  setAllowPrivateUrls(true);
  const page = await fetchPublicUrl(`${siteUrl}/redirect`, { maxBytes: 10_000 });
  assert.equal(page.url.pathname, "/page");
  assert.match(page.body.toString(), /Readable text/);
});

test("a download stops as soon as it passes the size limit", async () => {
  setAllowPrivateUrls(true);
  await assert.rejects(fetchPublicUrl(`${siteUrl}/big`, { maxBytes: 5_000 }), (err) => err instanceof UrlFetchError && err.status === 413);
});

test("POST /api/fetch-url still imports an allowed page", async () => {
  setAllowPrivateUrls(true);
  const res = await fetch(`${base}/api/fetch-url`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: `${siteUrl}/page` }),
  });
  const json = (await res.json()) as any;
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.title, "Report");
  assert.equal(json.text, "Readable text.");
});
