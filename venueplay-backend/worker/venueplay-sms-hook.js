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
 *   CLICKSEND_USERNAME       Optional BACKUP provider (21 Oct 2026). With this and
 *   CLICKSEND_API_KEY        CLICKSEND_API_KEY set, a Mobile Message error or
 *                            timeout falls through to ClickSend. Unset, nothing
 *                            changes. Setup: ~/venue-enrich/SMS-BACKUP-SETUP.md
 *   CLICKSEND_FROM           Optional. A sender ID registered with ClickSend.
 *                            Unset, ClickSend sends from its shared number.
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

/* The build stamp every other Worker carries. Without it deploy-worker.py refuses to ship
   this file, which is why the SMS hook had been pasted by hand and nothing could say which
   version was running. */
const BUILD = '21 Oct 2026, 00:54 · 024535ef';   // tools/stamp-workers.py, do not edit by hand

const FIVE_MINUTES_SECONDS = 60 * 5;

export default {
  async fetch(request, env) {
    /* /health, like every other Worker, so deploy-worker.py can prove the build and Dean can
       see whether the backup provider is switched on. Booleans only: never a secret. */
    if (request.method === "GET" && new URL(request.url).pathname === "/health") {
      return new Response(JSON.stringify({
        ok: true, build: BUILD,
        providers: { mobilemessage: hasMobileMessage(env), clicksend: hasClickSend(env) },
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
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

      // Both providers accept E.164, so pass Supabase's value through unchanged.
      const to = String(phone).trim();

      // custom_ref = the Supabase webhook id. It gives provider-side tracing and
      // a handle for de-duplicating retries later. Not sensitive.
      const customRef = String(request.headers.get("webhook-id") || "").slice(0, 64);

      const sent = await deliverSms(env, to, message, customRef);
      if (!sent.ok) {
        /* Supabase's documented hook error shape, so the sign-in screen gets a real error
           rather than a silent wait. The console reads any send failure as ours and offers
           the email code instead. */
        return new Response(
          JSON.stringify({ error: { http_code: 500, message: "Failed to send SMS" } }),
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

/* TWO PROVIDERS, BECAUSE ONE WENT DOWN.

   On 21 Oct 2026 Mobile Message stopped sending and, with it the only provider, no host at
   any venue could sign in: the phone code is the only way into a console. So the hook tries
   Mobile Message first, exactly as before, and if that errors or times out it tries ClickSend,
   but only when ClickSend's two secrets are set. Without them nothing changes, including the
   ten second wait.

   With a backup configured, Mobile Message gets a shorter wait. Supabase gives a hook about
   five seconds before it calls it a timeout, so a ten second first try would leave the backup
   no time at all. The cost: a Mobile Message that is slow but working can now lose the race,
   and a host may get the code twice. Twice beats never.

   The logs say WHICH provider sent or failed and its status, never the number or the code.
   The provider's response body is not logged either, because it can echo the number back. */
const PRIMARY_TIMEOUT_ALONE_MS = 10000;
const PRIMARY_TIMEOUT_WITH_BACKUP_MS = 2500;
const BACKUP_TIMEOUT_MS = 2200;

function hasMobileMessage(env) {
  return !!(env && env.MOBILEMESSAGE_USERNAME && env.MOBILEMESSAGE_PASSWORD);
}
function hasClickSend(env) {
  return !!(env && env.CLICKSEND_USERNAME && env.CLICKSEND_API_KEY);
}
/* A provider status word, safe to log: letters, digits, spaces and _ only, kept short. */
function safeWord(x) {
  return String(x == null ? "" : x).replace(/[^A-Za-z0-9 _-]/g, "").slice(0, 40);
}

async function deliverSms(env, to, message, customRef) {
  const backup = hasClickSend(env);
  const first = await sendViaMobileMessage(env, to, message, customRef,
    backup ? PRIMARY_TIMEOUT_WITH_BACKUP_MS : PRIMARY_TIMEOUT_ALONE_MS);
  if (first.ok) {
    console.log("SMS sent via mobilemessage");
    return { ok: true, provider: "mobilemessage" };
  }
  console.error("SMS mobilemessage failed: " + first.detail);
  if (!backup) {
    return { ok: false, provider: null };
  }
  const second = await sendViaClickSend(env, to, message, customRef, BACKUP_TIMEOUT_MS);
  if (second.ok) {
    console.log("SMS sent via clicksend (mobilemessage failed first)");
    return { ok: true, provider: "clicksend" };
  }
  console.error("SMS clicksend failed too: " + second.detail);
  return { ok: false, provider: null };
}

/* One POST with a hard deadline. Resolves { res, text } or throws (network error, abort). */
async function postWithDeadline(url, headers, body, timeoutMs) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: "POST", headers: headers, body: body, signal: abort.signal });
    const text = (await res.text()).trim();
    return { res: res, text: text };
  } finally {
    clearTimeout(timer);
  }
}

/* Mobile Message: HTTP 200 with a results array whose first entry says "success". */
async function sendViaMobileMessage(env, to, message, customRef, timeoutMs) {
  const sender = env.SMS_SENDER || "VenuePlay";
  const basicAuth = "Basic " + btoa((env.MOBILEMESSAGE_USERNAME || "") + ":" + (env.MOBILEMESSAGE_PASSWORD || ""));
  let r;
  try {
    r = await postWithDeadline("https://api.mobilemessage.com.au/v1/messages",
      { "Content-Type": "application/json", Authorization: basicAuth },
      JSON.stringify({ messages: [{ to: to, message: message, sender: sender, custom_ref: customRef }] }),
      timeoutMs);
  } catch (e) {
    return { ok: false, detail: (e && e.name === "AbortError") ? "timed out" : "network error" };
  }
  let status = "";
  try {
    const parsed = JSON.parse(r.text);
    if (parsed && Array.isArray(parsed.results) && parsed.results[0]) status = String(parsed.results[0].status || "");
  } catch (e) { /* unparseable: a failure below */ }
  if (!r.res.ok || status !== "success") {
    return { ok: false, detail: "status=" + r.res.status + " resultStatus=" + safeWord(status) };
  }
  return { ok: true };
}

/* ClickSend: POST /v3/sms/send, Basic auth with the account username and API key. Success is
   HTTP 200, response_code "SUCCESS", and the first message's status "SUCCESS". The sender is
   CLICKSEND_FROM when set (it must be registered with ClickSend); otherwise ClickSend uses its
   own shared number, which always delivers. */
async function sendViaClickSend(env, to, message, customRef, timeoutMs) {
  const basicAuth = "Basic " + btoa(env.CLICKSEND_USERNAME + ":" + env.CLICKSEND_API_KEY);
  const one = { source: "venueplay", body: message, to: to, custom_string: customRef };
  if (env.CLICKSEND_FROM) one.from = env.CLICKSEND_FROM;
  let r;
  try {
    r = await postWithDeadline("https://rest.clicksend.com/v3/sms/send",
      { "Content-Type": "application/json", Authorization: basicAuth },
      JSON.stringify({ messages: [one] }),
      timeoutMs);
  } catch (e) {
    return { ok: false, detail: (e && e.name === "AbortError") ? "timed out" : "network error" };
  }
  let code = "", status = "";
  try {
    const parsed = JSON.parse(r.text);
    code = String((parsed && parsed.response_code) || "");
    const msgs = parsed && parsed.data && parsed.data.messages;
    if (Array.isArray(msgs) && msgs[0]) status = String(msgs[0].status || "");
  } catch (e) { /* unparseable: a failure below */ }
  if (!r.res.ok || code !== "SUCCESS" || status !== "SUCCESS") {
    return { ok: false, detail: "status=" + r.res.status + " code=" + safeWord(code) + " messageStatus=" + safeWord(status) };
  }
  return { ok: true };
}

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
  /* MORE THAN ONE SECRET, BECAUSE A ROLLBACK NEEDS BOTH TO WORK.

     This held exactly one secret. On 12 Sep 2026 VenuePlay moved from the Singapore project
     to Sydney, and the new project issues its OWN hook secret: the moment this Worker was
     pointed at Sydney's, Singapore's hook stopped verifying. That is fine while the move
     holds, and it quietly destroys the rollback. Going back to Singapore would have left
     every host unable to receive a sign-in text on EITHER project, which is worse than the
     fault you were rolling back from.

     So the secret is a comma-separated list and any one of them may match. Put the new
     project's first and keep the old one until the move is settled, then drop it. Each is
     still the base64 half, after "v1,whsec_", exactly as before; a single secret with no
     comma behaves precisely as it always did. */
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

  // Compute the expected signature, once per configured secret.
  const signedContent = webhookId + "." + webhookTimestamp + "." + rawBody;

  /* A secret is itself base64 and base64 never contains a comma, so splitting on one is
     unambiguous. Blanks are dropped so a trailing comma cannot become an empty secret that
     throws on import and takes the good one down with it. */
  /* TAKE THE SECRET IN WHATEVER SHAPE SUPABASE SHOWED IT.

     Supabase displays the hook secret as "v1,whsec_<base64>" and this Worker wanted only the
     <base64> half. The header comment said so; on 12 Sep 2026 Dean pasted the whole displayed
     value, which is the obvious thing to do with a string a screen hands you. atob() threw on
     the comma, the outer catch turned it into a 500, Supabase reported "Unexpected status code
     returned from hook: 500", and the host saw "we could not send a code" with no clue why.
     A Worker that refuses the exact string its own dashboard gives you is a trap.

     ORDER MATTERS: "v1,whsec_" contains a comma, so the prefix goes BEFORE the list is split,
     or one secret becomes the two useless halves "v1" and "whsec_<base64>". */
  const secrets = String(secretB64)
    /* BELT AND BRACES, and prove-checks proved it. Breaking this line on purpose did not
       make a single check go red, because splitting on the comma and stripping whsec_ from
       each entry already handles "v1,whsec_<base64>" on its own: it becomes the two entries
       "v1" and "<base64>", and the loop tries both. Kept because it states the intent and
       costs nothing, but it is not the mechanism; the strip below is. */
    .replace(/v\d+\s*,\s*whsec_/gi, "whsec_")
    .split(",")
    .map(function (x) { return x.trim().replace(/^whsec_/i, ""); })
    .filter(function (x) { return x.length > 0; });
  if (!secrets.length) {
    return { ok: false, reason: "SEND_SMS_HOOK_SECRET is set but empty" };
  }

  // The header may carry several space-separated signatures, each prefixed
  // with a version like "v1,".
  const provided = webhookSignature.split(" ");

  for (let s = 0; s < secrets.length; s++) {
    let expectedSignature;
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "raw",
        base64ToBytes(normaliseB64(secrets[s])),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        cryptoKey,
        new TextEncoder().encode(signedContent)
      );
      expectedSignature = bytesToBase64(new Uint8Array(signatureBuffer));
    } catch (e) {
      /* One malformed secret must not stop the others being tried: a rollback list is typed
         by hand under pressure, which is exactly when a character goes missing.

         BUT IT MUST SAY SO. Silently continuing turned a ReferenceError into "no matching
         signature", which is indistinguishable from a stranger knocking. It cost a round of
         debugging on 12 Sep 2026 and in production it would have looked like a wrong secret
         when the real fault was in this file. */
      console.error("SMS hook: secret " + (s + 1) + " of " + secrets.length +
                    " could not be used: " + ((e && e.message) || e));
      continue;
    }
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
/* Base64 that atob() will actually accept. Supabase's secret is standard base64, but a value
   that has been through a URL or a copy-paste can arrive base64url (- and _ for + and /) or
   with its padding trimmed. Rejecting those throws, and a throw here reads to the host as "we
   could not send a code" with no clue why: exactly what happened on 12 Sep 2026. */
function normaliseB64(x) {
  var out = String(x).replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "");
  while (out.length % 4 !== 0) { out += "="; }
  return out;
}

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
