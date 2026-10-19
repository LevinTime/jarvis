export const MAX_BODY_BYTES = 32_000;

export const STRICT_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self'",
  // Embla, Wisch-Zeilen und die Tastatur-Höhe setzen style-Attribute. Skripte bleiben bei 'self'.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
].join("; ");

export const LEGACY_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
].join("; ");

export function apiError(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

export function isLocalAddress(remote: string | undefined): boolean {
  if (!remote) {
    return true;
  }
  const host = remote.replace(/^::ffff:/, "");
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

export function originAllowed(origin: string, host: string | undefined): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    return true;
  }
  const hostname = (host ?? "").trim().replace(/:\d+$/, "");
  return hostname.length > 0 && url.hostname === hostname;
}

export function tailscaleAllowed(input: {
  allowedUser?: string;
  header?: string;
  remote?: string;
}): boolean {
  const allowed = input.allowedUser?.trim() ?? "";
  if (!allowed) {
    return true;
  }
  const header = input.header?.trim() ?? "";
  if (header) {
    return header === allowed;
  }
  return isLocalAddress(input.remote);
}

export function createRateLimit(limit: number, windowMs: number) {
  const hits: number[] = [];
  return {
    allow(now = Date.now()): boolean {
      const cutoff = now - windowMs;
      while (hits.length > 0 && (hits[0] ?? 0) <= cutoff) {
        hits.shift();
      }
      if (hits.length >= limit) {
        return false;
      }
      hits.push(now);
      return true;
    },
  };
}
