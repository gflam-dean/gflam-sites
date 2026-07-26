/**
 * VenuePlay - Supabase Auth "Send SMS Hook" Worker
 * =================================================
 *
 * Deploy this as its own Cloudflare Worker (see "Setup steps" below).
 *
 * Purpose
 * -------
 * Supabase Auth calls this Worker whenever a Phone sign-in generates a one-time
 * code (OTP). This Worker verifies the request came from Supabase (Standard
 * Webhooks signature) and delivers the code by SMS through the Australian
 * provider Mobile Message (mobilemessage.com.au).
 *
 * Supabase Send SMS Hook payload shape:
 *   { "user": { "phone": "+61412345678", ... }, "sms": { "otp": "123456" } }
 * We read user.phone and sms.otp, and are defensive about alternative shapes.
 *
 * Environment variables (set as Cloudflare Worker secrets)
 * -------------------------------------------------------
 *   SEND_SMS_HOOK_SECRET     The base64 part of the Supabase hook signing secret.
 *                            Supabase provides the secret as "v1,whsec_<base64>".
 *                            Store ONLY the <base64> part here (everything after
 *                            "v1,whsec_"). REQUIRED. If unset, every request is
 *                            rejected with 401 (fail closed) unless ALLOW_UNSIGNED
 *                            is explicitly "true".
 *   ALLOW_UNSIGNED           Optional escape hatch for a pre-secret test window
 *                            only. Set to "true" to skip signature verification.
 *                            NEVER set this in production - it lets anyone who
 *                            learns the URL send SMS on your account.
 *   MOBILEMESSAGE_USERNAME   Your Mobile Message API username (API key).
 *   MOBILEMESSAGE_PASSWORD   Your Mobile Message API password (API secret).
 *   SMS_SENDER               The "sender" value. Either a registered sender ID of
 *                            up to 11 alphanumeric characters (e.g. "VenuePlay")
 *                            or a registered number. Must be registered on your
 *                            Mobile Message account. Optional; defaults to
 *                            "VenuePlay".
 *
 * Setup steps
 * -----------
 *   1. Deploy this file as its own Cloudflare Worker and set the secrets
 *      (`npx wrangler secret put SEND_SMS_HOOK_SECRET`,
 *      `npx wrangler secret put MOBILEMESSAGE_USERNAME`,
 *      `npx wrangler secret put MOBILEMESSAGE_PASSWORD`, and optionally
 *      `npx wrangler secret put SMS_SENDER`).
 *   2. In the Supabase Dashboard, go to Authentication > Providers and enable
 *      Phone.
 *   3. In Authentication > Hooks (Auth Hooks), configure the "Send SMS" hook:
 *      set its URL to this Worker's public URL, then copy the generated secret.
 *      It looks like "v1,whsec_<base64>" - copy only the <base64> part (after
 *      "v1,whsec_") into the SEND_SMS_HOOK_SECRET Worker secret.
 *
 * Mobile Message API reference
 * ----------------------------
 *   REST API (HTTP Basic auth with API username/password):
 *   POST https://api.mobilemessage.com.au/v1/messages
 *   Header: Authorization: Basic base64(username:password)
 *   Body (JSON):
 *     { "messages": [ { "to": "0412345678", "message": "...",
 *                       "sender": "VenuePlay", "custom_ref": "..." } ] }
 *   Success (HTTP 200): { "status": "complete",
 *     "results": [ { "status": "success", "message_id": "...", "cost": 1 } ] }
 *   Each recipient result carries its own "status"; we treat anything other than
 *   "success" on the first result as a failure. The "to" field accepts local
 *   (0412...) or international (+61412...) format, so we pass Supabase's E.164
 *   value through unchanged.
 *   Docs: https://mobilemessage.com.au/api-documentation
 *
 * Notes: plain ES module, Australian English, Web Crypto only for HMAC.
 */

const FIVE_MINUTES_SECONDS = 60 * 5;

export default {
  async fetch(request, env) {
    // Only accept POST. Supabase always POSTs the hook payload.
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // Read the raw body first: signature verification must run over the exact
      // bytes Supabase signed, so we cannot re-serialise the parsed JSON.
      const rawBody = await request.text();

      // Verify the Standard Webhooks signature (or skip with a warning).
      const verification = await verifySignature(request, rawBody, env);
      if (!verification.ok) {
        console.warn("SMS hook signature verification failed:", verification.reason);
        return new Response("Unauthorised", { status: 401 });
      }

      // Parse the payload.
      let payload;
      try {
        payload = JSON.parse(rawBody);
      } catch (err) {
        console.warn("SMS hook received a body that is not valid JSON.");
        return new Response("Bad Request", { status: 400 });
      }

      // Be defensive about where the phone and otp live.
      const phone =
        (payload.user && payload.user.phone) || payload.phone || "";
      const otp =
        (payload.sms && payload.sms.otp) || payload.otp || "";

      if (!phone || !otp) {
        // Do not log the otp value here.
        console.warn(
          "SMS hook missing phone or otp. phonePresent=" +
            Boolean(phone) +
            " otpPresent=" +
            Boolean(otp)
        );
        return new Response("Bad Request", { status: 400 });
      }

      // Build the message. We avoid logging the full code anywhere.
      const message =
        "Your VenuePlay code is " + otp + ". It expires in a few minutes.";
      const sender = env.SMS_SENDER || "VenuePlay";

      // Send via the Mobile Message REST API. It accepts local or international
      // recipient formats, so pass the E.164 value through unchanged.
      const to = String(phone).trim();

      const username = env.MOBILEMESSAGE_USERNAME || "";
      const password = env.MOBILEMESSAGE_PASSWORD || "";
      const basicAuth = "Basic " + btoa(username + ":" + password);

      // custom_ref = the Supabase webhook id. It gives provider-side tracing and
      // a handle for de-duplicating retries later. Not sensitive.
      const customRef = String(request.headers.get("webhook-id") || "").slice(0, 64);

      // Abort a hung provider fast so it fails deterministically instead of
      // stalling until Cloudflare's wall-clock limit (which Supabase reads as a
      // timeout and retries, risking a double-send).
      const abort = new AbortController();
      const abortTimer = setTimeout(() => abort.abort(), 10000);

      let providerResponse;
      let providerText;
      try {
        providerResponse = await fetch(
          "https://api.mobilemessage.com.au/v1/messages",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: basicAuth,
            },
            body: JSON.stringify({
              messages: [
                {
                  to: to,
                  message: message,
                  sender: sender,
                  custom_ref: customRef,
                },
              ],
            }),
            signal: abort.signal,
          }
        );
        providerText = (await providerResponse.text()).trim();
      } finally {
        clearTimeout(abortTimer);
      }

      // Mobile Message returns HTTP 200 with a results array; each result has
      // its own "status" that is "success" on delivery acceptance. Treat a
      // non-200, unparseable body, or a non-"success" first result as failure.
      let firstResultStatus = "";
      try {
        const parsed = JSON.parse(providerText);
        if (parsed && Array.isArray(parsed.results) && parsed.results[0]) {
          firstResultStatus = String(parsed.results[0].status || "");
        }
      } catch (err) {
        // Leave firstResultStatus empty; handled as a failure below.
      }

      if (!providerResponse.ok || firstResultStatus !== "success") {
        // Log the provider response server-side for debugging, but do not leak
        // provider internals in the HTTP response body.
        console.error(
          "Mobile Message send failed. status=" +
            providerResponse.status +
            " resultStatus=" +
            firstResultStatus +
            " response=" +
            providerText
        );
        return new Response(
          JSON.stringify({ error: "Failed to send SMS" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      // Supabase needs a 200 to consider the hook handled. Empty JSON object.
      return new Response("{}", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      console.error("SMS hook unexpected error:", err && err.message ? err.message : err);
      return new Response(
        JSON.stringify({ error: "Internal error" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }
  },
};

/**
 * Verify the Standard Webhooks signature that Supabase attaches to hook
 * requests.
 *
 * Headers:
 *   webhook-id         unique message id
 *   webhook-timestamp  unix seconds when the message was created
 *   webhook-signature  space-separated list of "v1,<base64sig>" entries
 *
 * Signed content is `${webhook-id}.${webhook-timestamp}.${rawBody}`, signed
 * with HMAC-SHA256 using the base64-decoded secret as the key, then base64
 * encoded.
 *
 * Returns { ok: true } on success, or { ok: false, reason } on failure.
 * If SEND_SMS_HOOK_SECRET is unset, this FAILS CLOSED (rejects the request)
 * unless ALLOW_UNSIGNED is explicitly "true". Production MUST set the secret.
 */
async function verifySignature(request, rawBody, env) {
  const secretB64 = env.SEND_SMS_HOOK_SECRET;

  if (!secretB64) {
    // FAIL CLOSED. Without the signing secret we cannot prove the request came
    // from Supabase, so we must reject it. A fail-open skip here would let any
    // party who learns the Worker URL send SMS on our Mobile Message account
    // (SMS toll fraud). If you genuinely need a pre-secret test window, set the
    // explicit env var ALLOW_UNSIGNED="true" - never leave that on in production.
    if (env.ALLOW_UNSIGNED === "true") {
      console.warn(
        "ALLOW_UNSIGNED=true: skipping signature verification. " +
          "This must NEVER be set in production."
      );
      return { ok: true };
    }
    return { ok: false, reason: "SEND_SMS_HOOK_SECRET not set" };
  }

  const webhookId = request.headers.get("webhook-id");
  const webhookTimestamp = request.headers.get("webhook-timestamp");
  const webhookSignature = request.headers.get("webhook-signature");

  if (!webhookId || !webhookTimestamp || !webhookSignature) {
    return { ok: false, reason: "missing webhook signature headers" };
  }

  // Reject stale or future-skewed timestamps (~5 minute tolerance).
  const timestampSeconds = Number(webhookTimestamp);
  if (!Number.isFinite(timestampSeconds)) {
    return { ok: false, reason: "invalid webhook-timestamp" };
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const skew = Math.abs(nowSeconds - timestampSeconds);
  if (skew > FIVE_MINUTES_SECONDS) {
    return { ok: false, reason: "webhook-timestamp skew too large" };
  }

  // Compute the expected signature.
  const signedContent = webhookId + "." + webhookTimestamp + "." + rawBody;
  const keyBytes = base64ToBytes(secretB64);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedContent)
  );
  const expectedSignature = bytesToBase64(new Uint8Array(signatureBuffer));

  // The header may carry several space-separated signatures, each prefixed
  // with a version like "v1,". Compare against each (constant-time).
  const provided = webhookSignature.split(" ");
  for (let i = 0; i < provided.length; i++) {
    const entry = provided[i];
    if (!entry) {
      continue;
    }
    // Strip the "v1," (or similar "vN,") version prefix if present.
    const commaIndex = entry.indexOf(",");
    const sigValue = commaIndex >= 0 ? entry.slice(commaIndex + 1) : entry;
    if (constantTimeEqual(sigValue, expectedSignature)) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "no matching signature" };
}

/**
 * Constant-time string comparison. Compares over the length of the longer
 * string to avoid leaking length via early exit timing.
 */
function constantTimeEqual(a, b) {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const length = Math.max(aBytes.length, bBytes.length);
  let result = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i++) {
    const aByte = i < aBytes.length ? aBytes[i] : 0;
    const bByte = i < bBytes.length ? bBytes[i] : 0;
    result |= aByte ^ bByte;
  }
  return result === 0;
}

/** Decode a base64 string into a Uint8Array. */
function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Encode a Uint8Array into a base64 string. */
function bytesToBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
