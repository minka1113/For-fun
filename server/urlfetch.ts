// Fetching a URL a user (or the research agent) supplied, safely.
//
// The server runs inside a private network, so a URL import must not be usable to reach internal
// services: every address a hostname resolves to is checked, redirects are followed by hand so
// each hop is checked too, and the download stops as soon as it passes the size limit.
//
// The hostname is resolved again by fetch itself, so a DNS server that answers differently the
// second time ("DNS rebinding") could still slip past the check. The deployment's other controls
// (instance-metadata tokens, security groups) remain the backstop for that.

import { lookup } from "node:dns/promises";
import net from "node:net";

let allowPrivate = process.env.ALLOW_PRIVATE_URLS === "1";

/** Allow private and loopback addresses (tests, or a deliberate local setup via ALLOW_PRIVATE_URLS=1). */
export function setAllowPrivateUrls(allow: boolean): void {
  allowPrivate = allow;
}

export class UrlFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const MAX_REDIRECTS = 5;

/** True for loopback, private, link-local, carrier-grade NAT, multicast and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      /^f[cd]/.test(lower) || // unique local fc00::/7
      /^fe[89ab]/.test(lower) || // link-local fe80::/10
      /^ff/.test(lower) // multicast
    );
  }
  return true; // not an IP address at all: refuse
}

async function checkHost(url: URL): Promise<void> {
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new UrlFetchError("Only http(s) web addresses can be imported.", 400);
  if (allowPrivate) return;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = net.isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (addresses.length === 0) throw new UrlFetchError("Couldn't find that website. Check the address.", 400);
  if (addresses.some(isPrivateAddress)) {
    throw new UrlFetchError("That address points to a private or internal network, so it can't be imported.", 400);
  }
}

/** Read a response body, stopping as soon as it exceeds maxBytes. */
async function readCapped(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length"));
  if (declared > maxBytes) throw new UrlFetchError("That file is too large to import.", 413);
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new UrlFetchError("That file is too large to import.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

export interface FetchedPage {
  url: URL;
  contentType: string;
  body: Buffer;
}

/** Fetch a public web page or file, following up to five redirects and checking each one. */
export async function fetchPublicUrl(raw: string, opts: { maxBytes: number; timeoutMs?: number }): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UrlFetchError("Enter a full http(s) URL.", 400);
  }
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 15_000);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await checkHost(url);
    const res = await fetch(url, {
      headers: { "user-agent": "SourceLens/0.1 (research summariser)" },
      redirect: "manual",
      signal,
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = new URL(res.headers.get("location")!, url);
      await res.body?.cancel().catch(() => {});
      continue;
    }
    if (!res.ok) throw new UrlFetchError(`The page returned HTTP ${res.status}.`, 502);
    return { url, contentType: res.headers.get("content-type") ?? "", body: await readCapped(res, opts.maxBytes) };
  }
  throw new UrlFetchError("That address redirects too many times.", 502);
}
