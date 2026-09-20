import { createHmac, timingSafeEqual } from "node:crypto";

export function signVideoOperation(operation: string, key: string) {
  if (!/^models\/[\w.-]+\/operations\/[\w.-]+$/.test(operation)) throw new Error("Invalid video operation.");
  const data = Buffer.from(JSON.stringify({ operation, expires: Date.now() + 12 * 3600_000 })).toString("base64url");
  return `${data}.${createHmac("sha256", key).update(data).digest("base64url")}`;
}
export function readVideoOperation(token: string, key: string): string {
  if (token.length > 2000) throw new Error("Invalid video token.");
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra) throw new Error("Invalid video token.");
  const expected = createHmac("sha256", key).update(data).digest();
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error("Invalid video token.");
  const parsed = JSON.parse(Buffer.from(data, "base64url").toString());
  if (!Number.isFinite(parsed.expires) || parsed.expires < Date.now() || typeof parsed.operation !== "string" || !/^models\/[\w.-]+\/operations\/[\w.-]+$/.test(parsed.operation)) throw new Error("Video session expired.");
  return parsed.operation;
}
