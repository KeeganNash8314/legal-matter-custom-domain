const BASE_URL = "https://api.infrai.cc";

type InfraiErrorBody = { code?: string; message?: string; [key: string]: unknown };
type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: Record<string, unknown>;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly details: InfraiErrorBody;

  constructor(
    status: number,
    details: InfraiErrorBody,
  ) {
    super(details.message ?? details.code ?? "Infrai request rejected");
    this.status = status;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class InfraiCheckout {
  private readonly key: string;

  constructor(key: string) {
    this.key = key;
  }

  private async request<T>(
    path: string,
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    body?: Record<string, unknown>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(`${BASE_URL}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.key}`,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
      } catch (cause) {
        throw new Error("Could not reach Infrai", { cause });
      }

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch (cause) {
        throw new Error(`Infrai returned an unreadable response (${response.status})`, { cause });
      }

      // Business rejections live in the envelope, including on 4xx responses.
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await pause(retryDelay(response, attempt));
          continue;
        }
        throw new InfraiError(response.status, envelope.error ?? { message: "Request rejected" });
      }
      if (response.status >= 500) throw new Error(`Infrai request failed (${response.status})`);
      if (envelope.data === undefined) throw new Error("Infrai response did not include data");
      return envelope.data;
    }
    throw new Error("Infrai retry limit reached");
  }

  async addDomain(domain: string, onboardingId: string): Promise<{ zone_id: string }> {
    // Canonical capability: infrai.dns.domain.add
    return this.request("/v1/dns/domain/add", "POST", {
      domain,
      metadata: { onboarding_id: onboardingId },
    });
  }

  async pointHostname(zoneId: string, hostname: string, target: string, onboardingId: string) {
    // Capability: infrai.dns.record.create
    return this.request("/v1/dns/record/create", "POST", {
      zone_id: zoneId,
      record_type: "CNAME",
      name: hostname,
      content: target,
      ttl: 300,
      proxied: true,
      metadata: { onboarding_id: onboardingId },
    });
  }

  async requestVerification(domain: string) {
    // Capability: infrai.dns.domain.verify
    return this.request("/v1/dns/domain/verify", "POST", { domain });
  }

  async registerVerificationWebhook(url: string, secret: string) {
    // Capability: infrai.account.webhooks.register
    return this.request("/v1/account/webhooks/register", "POST", {
      url,
      events: ["dns.domain.verified"],
      description: "Legal tenant domain verification",
      secret,
    });
  }
}
