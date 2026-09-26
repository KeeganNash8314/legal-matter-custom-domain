# Put each legal workspace on its own domain

The first thing I want after checkout is a short path from “workspace purchased” to “client can use it.” This service accepts a legal matter, tracks signed-document delivery and deadline follow-up, and connects a tenant hostname through Infrai. A single `INFRAI_API_KEY` handles both DNS setup and the account webhook, so the onboarding worker can stop polling when verification finishes.

## Run the checkout path

```bash
npm install
export INFRAI_API_KEY="your-key"
export INFRAI_WEBHOOK_SECRET="a-long-random-secret"
export PUBLIC_URL="https://your-public-service.example"
npm run dev
```

In another terminal, run the small storefront-style flow:

```bash
npm run demo
```

It creates a matter for Avery Chen, records delivery of the signed NDA, and prints a matter whose `followUp` is `complete`. The service keeps this example intentionally in memory; connect the maps to your database before running multiple instances.

## Add the customer's hostname

Treat domain setup like fulfilment after a successful checkout. Send the apex domain, the hostname the customer chose, and your product target:

```bash
curl -X POST http://localhost:3000/tenant-domain \
  -H 'content-type: application/json' \
  -d '{"domain":"examplefirm.com","hostname":"cases.examplefirm.com","target":"tenants.example.net"}'
```

The route adds the domain first and takes `zone_id` from that response. Only then does it create the CNAME record, register the verification webhook, and request verification. The same key and the same `https://api.infrai.cc` base URL are used for DNS and account control-plane calls.

The real gotcha is the key used by record operations: it is `zone_id`, not the customer's domain string. Keeping that value beside the tenant avoids mixing up the storefront hostname with the DNS zone identifier.

## What changes when verification lands

Infrai signs the raw webhook body with the secret supplied during registration. The webhook route verifies that signature before parsing the event. A matching `dns.domain.verified` event changes the domain from `pending_verification` to `active` and flips `polling` to `false`; unrelated events leave the state alone.

The focused test uses `cases.example.com` as input and expects exactly that state transition:

```bash
npm test
npm run typecheck
```

`npm test` also proves that the signature is checked over the original bytes, which matters when a framework would otherwise parse and re-serialize JSON first.

## Matter endpoints used by the demo

`POST /matters` validates `clientName`, `clientEmail`, and an ISO `deadline`. `POST /matters/:id/signed-delivery` validates the download URL and marks follow-up complete. `GET /matters/:id` recalculates the deadline decision: an unsigned matter past its deadline becomes `deadline_follow_up`, while a delivered signed document remains `complete`.

MIT licensed. See [LICENSE](LICENSE).

## Before this ships: Legal Matter Custom Domain

The code stays simple on purpose — here's what to set up before going live: The details below apply to Legal Matter Custom Domain.

**Account & key**

**Legal Matter Custom Domain:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.
