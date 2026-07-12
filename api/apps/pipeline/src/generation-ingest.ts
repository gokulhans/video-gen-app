const INGEST_TTL_SECONDS = 15 * 60;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function key(secret: string): Promise<CryptoKey> {
  if (secret.length < 32) throw new Error("generation_ingest_signing_secret_unavailable");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}

export async function generationMasterIngestUrl(
  appBaseUrl: string,
  signingSecret: string,
  objectKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ v: 1, k: objectKey, e: nowSeconds + INGEST_TTL_SECONDS })));
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign(
    "HMAC",
    await key(signingSecret),
    new TextEncoder().encode(`generation-master:v1:${payload}`),
  )));
  return `${appBaseUrl.replace(/\/$/, "")}/media/generation/${payload}.${signature}`;
}
