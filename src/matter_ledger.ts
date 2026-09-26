import { createHmac, timingSafeEqual } from "node:crypto";

export type DomainState = {
  domain: string;
  zoneId: string;
  status: "pending_verification" | "active";
  polling: boolean;
};

export type Matter = {
  id: string;
  clientName: string;
  clientEmail: string;
  deadline: string;
  signedDocument?: { downloadUrl: string; deliveredAt: string };
  followUp: "waiting_for_signature" | "deadline_follow_up" | "complete";
};

export function verifyWebhook(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (signature.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function applyVerificationEvent(
  current: DomainState,
  event: { type: string; domain: string },
): DomainState {
  if (event.type !== "dns.domain.verified" || event.domain !== current.domain) return current;
  return { ...current, status: "active", polling: false };
}

export function followUpDecision(matter: Matter, now: Date): Matter["followUp"] {
  if (matter.signedDocument) return "complete";
  return now >= new Date(matter.deadline) ? "deadline_follow_up" : "waiting_for_signature";
}
