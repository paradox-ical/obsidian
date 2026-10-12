import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function shopKeySecretReady(): boolean {
  return (process.env["SHOP_KEY_SECRET"] ?? "").length >= 16;
}

function secretKey(): Buffer | null {
  const material = process.env["SHOP_KEY_SECRET"] ?? "";
  if (material.length < 16) {
    return null;
  }
  return createHash("sha256").update(material).digest();
}

export function sealShopKey(plain: string): { ciphertext: string; nonce: string } | null {
  const key = secretKey();
  const trimmed = plain.trim();
  if (!key || !trimmed) {
    return null;
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(trimmed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { ciphertext: Buffer.concat([body, tag]).toString("base64"), nonce: nonce.toString("base64") };
}

export function openShopKey(ciphertext: string, nonce: string): string | null {
  const key = secretKey();
  if (!key) {
    return null;
  }
  try {
    const packed = Buffer.from(ciphertext, "base64");
    if (packed.length < 17) {
      return null;
    }
    const tag = packed.subarray(packed.length - 16);
    const body = packed.subarray(0, packed.length - 16);
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
