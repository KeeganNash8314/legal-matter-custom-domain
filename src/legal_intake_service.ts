import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { InfraiCheckout, InfraiError } from "./infrai_checkout.js";
import {
  applyVerificationEvent,
  followUpDecision,
  verifyWebhook,
  type DomainState,
  type Matter,
} from "./matter_ledger.js";

const key = process.env.INFRAI_API_KEY;
const webhookSecret = process.env.INFRAI_WEBHOOK_SECRET;
const publicUrl = process.env.PUBLIC_URL;
if (!key || !webhookSecret || !publicUrl) {
  throw new Error("Set INFRAI_API_KEY, INFRAI_WEBHOOK_SECRET, and PUBLIC_URL");
}
const validatedWebhookSecret: string = webhookSecret;

const infrai = new InfraiCheckout(key);
const domains = new Map<string, DomainState>();
const matters = new Map<string, Matter>();

const domainInput = z.object({
  domain: z.string().min(3),
  hostname: z.string().min(3),
  target: z.string().min(3),
});
const matterInput = z.object({
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
  deadline: z.string().datetime(),
});
const deliveryInput = z.object({ downloadUrl: z.string().url() });
const eventInput = z.object({ type: z.literal("dns.domain.verified"), domain: z.string() });

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}

async function route(request: IncomingMessage, response: ServerResponse) {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");

  if (method === "POST" && url.pathname === "/tenant-domain") {
    const input = domainInput.parse(JSON.parse(await readBody(request)));
    const onboardingId = randomUUID();
    const added = await infrai.addDomain(input.domain, onboardingId);
    await infrai.pointHostname(added.zone_id, input.hostname, input.target, onboardingId);
    await infrai.registerVerificationWebhook(`${publicUrl}/webhooks/domain-verified`, validatedWebhookSecret);
    await infrai.requestVerification(input.domain);
    const state: DomainState = {
      domain: input.domain,
      zoneId: added.zone_id,
      status: "pending_verification",
      polling: true,
    };
    domains.set(input.domain, state);
    return json(response, 202, state);
  }

  if (method === "POST" && url.pathname === "/webhooks/domain-verified") {
    const raw = await readBody(request);
    const signature = request.headers["x-infrai-signature"];
    if (typeof signature !== "string" || !verifyWebhook(raw, signature, validatedWebhookSecret)) {
      return json(response, 401, { error: "Invalid webhook signature" });
    }
    const event = eventInput.parse(JSON.parse(raw));
    const current = domains.get(event.domain);
    if (current) domains.set(event.domain, applyVerificationEvent(current, event));
    return json(response, 200, { received: true });
  }

  if (method === "POST" && url.pathname === "/matters") {
    const input = matterInput.parse(JSON.parse(await readBody(request)));
    const matter: Matter = {
      id: randomUUID(),
      ...input,
      followUp: "waiting_for_signature",
    };
    matters.set(matter.id, matter);
    return json(response, 201, matter);
  }

  const deliveryMatch = url.pathname.match(/^\/matters\/([^/]+)\/signed-delivery$/);
  if (method === "POST" && deliveryMatch) {
    const matter = matters.get(deliveryMatch[1]);
    if (!matter) return json(response, 404, { error: "Matter not found" });
    const input = deliveryInput.parse(JSON.parse(await readBody(request)));
    matter.signedDocument = { ...input, deliveredAt: new Date().toISOString() };
    matter.followUp = followUpDecision(matter, new Date());
    return json(response, 200, matter);
  }

  const matterMatch = url.pathname.match(/^\/matters\/([^/]+)$/);
  if (method === "GET" && matterMatch) {
    const matter = matters.get(matterMatch[1]);
    if (!matter) return json(response, 404, { error: "Matter not found" });
    matter.followUp = followUpDecision(matter, new Date());
    return json(response, 200, matter);
  }

  return json(response, 404, { error: "Route not found" });
}

const server = createServer((request, response) => {
  route(request, response).catch((error: unknown) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json(response, 400, { error: "Invalid request body" });
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return json(response, status, { error: error.message, details: error.details });
    }
    console.error(error);
    return json(response, 500, { error: "Request failed" });
  });
});

const port = Number(process.env.PORT ?? 3000);
server.listen(port, () => console.log(`Legal intake service listening on http://localhost:${port}`));
