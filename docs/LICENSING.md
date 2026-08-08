# Licensing — how to actually switch it on

The client half is built. What is missing is a server that signs activation
tokens, and the four values in `LIC` at the top of the licence block in
`js/features-v2.js`.

---

## Why it works this way

The version this replaced stored `{ok: true}` in localStorage. Anyone who opened
DevTools — in a CEP panel, that is a right-click away — could type that in and be
licensed. The trial start sat in localStorage too, so clearing site data granted
another seven days, forever.

Nothing running on the customer's machine can be made uncrackable. The goal is
to move the attack from *"edit one string"* to *"patch the app binary and
re-sign it"*, which is far more effort than the price of a licence.

So: **the client never decides that it is licensed.** It only checks whether a
blob carries a valid Ed25519 signature from a key it does not have.

```
                    ┌─────────────────────────────┐
  key + deviceId →  │  your server                │
                    │  · is the key real?         │
                    │  · seats left for this key? │
                    │  · sign {key,device,exp,…}  │
                    └──────────────┬──────────────┘
                                   │  token = b64url(payload).b64url(sig)
                                   ▼
                    ┌─────────────────────────────┐
                    │  Subsper                    │
                    │  · verify sig (public key)  │
                    │  · device matches this one? │
                    │  · not expired?             │
                    └─────────────────────────────┘
```

Forging the token needs the private key. Copying someone else's token to another
machine fails the `device` check. Editing the payload breaks the signature.

---

## 1. Generate the key pair

```bash
openssl genpkey -algorithm ed25519 -out subsper-licence-private.pem
openssl pkey -in subsper-licence-private.pem -pubout -out subsper-licence-public.pem
```

The **public** key goes into the app. The **private** key goes on the server and
never leaves it. If it leaks, every licence ever issued becomes forgeable and you
have to ship a new public key and re-issue.

---

## 2. Fill in `LIC` in `js/features-v2.js`

```js
const LIC = {
    enabled:       true,
    trialDays:     7,
    productId:     "subsper-pro",
    activationUrl: "https://api.yourdomain.com/activate",
    publicKeyPem:  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA…
-----END PUBLIC KEY-----`,
};
```

Remember to run `scripts/sync-from-extension.sh` so the desktop copy matches, or
CI's mirror check will fail.

An empty `publicKeyPem` **fails closed**: no token can verify, so the app stays
in trial. That is deliberate — a misconfiguration must never accidentally
license everyone.

---

## 3. The activation endpoint

**Request**

```http
POST /activate
Content-Type: application/json

{ "key": "XXXX-XXXX-XXXX-XXXX", "product": "subsper-pro", "device": "9f2c…" }
```

**Response — success**

```json
{ "token": "eyJrZXkiOi…....MEUCIQD…" }
```

**Response — failure**

```json
{ "error": "This key has already been activated on 3 devices." }
```

The `error` string is shown to the user verbatim, so write it for them, not for
your logs.

### Payload to sign

```json
{
  "key":     "XXXX-XXXX-XXXX-XXXX",
  "product": "subsper-pro",
  "device":  "9f2c…",
  "plan":    "pro",
  "iat":     1767225600000,
  "exp":     null
}
```

- `device` **must** be echoed back from the request. The client compares it to
  its own fingerprint and rejects a mismatch — this is what stops a token being
  shared.
- `exp` is milliseconds since epoch, or `null` for a perpetual licence. For a
  subscription, set it a little beyond the billing period and re-issue on renewal.
- `product` must equal `LIC.productId`.

### Token format

```
base64url( JSON.stringify(payload) ) + "." + base64url( ed25519_sign(privateKey, thatFirstBase64String) )
```

Note the signature covers the **base64url text**, not the raw JSON — the client
verifies the bytes it received, so no canonicalisation questions arise.

Node reference:

```js
import crypto from "node:crypto";

function signActivation(payload, privateKeyPem) {
    const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const key = crypto.createPrivateKey(privateKeyPem);
    const sig = crypto.sign(null, Buffer.from(b64), key);   // null = Ed25519
    return b64 + "." + sig.toString("base64url");
}
```

### Seat counting

The server owns this. Keep `(key, device)` rows; on activation, insert if the
key has seats left, otherwise return an `error`. The client sends the same
`device` every time, so re-activating on the same machine is idempotent.

---

## 4. Wiring a payment provider

Any provider works — the server is the only thing that talks to it.

- **Gumroad / Lemon Squeezy / Paddle**: on purchase they hand you a licence key
  and a verification API. Your `/activate` verifies the key with them, then adds
  the seat and signs the token.
- **Stripe**: generate your own key on `checkout.session.completed`, e-mail it,
  and store it.

Keep verification on your server. Calling the provider directly from the app
puts the "is it valid" decision back on the client, which is the problem this
design exists to avoid.

---

## What the client already does

| | |
|---|---|
| Trial anchor | app-data folder **and** localStorage; the **earliest** wins, so clearing browser storage does not reset it |
| Clock rollback | a monotonic `seen` timestamp; winding the clock back reads as "expired", not as free days |
| Device binding | SHA-256 of platform, arch, hostname, CPU model, core count, total RAM — stable across reinstalls, different on another machine |
| Gate | wraps `startTranscription`, `exportAs`, `sendToPremiere` |
| Offline | after activation, verification is local. No network needed again. |

The device ID is shown under the licence box so a customer can quote it to
support.

---

## Before you turn it on

- [ ] Key pair generated, private key on the server only
- [ ] `/activate` live, returning signed tokens
- [ ] `LIC.enabled = true`, other three values filled in
- [ ] `scripts/sync-from-extension.sh` run, `dev/test/check-mirror.sh` green
- [ ] Bought a licence end-to-end yourself with a real card
- [ ] Checked a token from machine A is rejected on machine B
- [ ] Decided what happens at seat limit and written that `error` string
- [ ] Refund path known — deactivating a seat is a server-side delete
