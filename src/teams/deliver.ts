import { AdaptiveCard } from "./card";

export type DeliveryResult =
  | { attempted: false; reason: string }
  | { attempted: true; delivered: boolean; status?: number; error?: string };

/**
 * POST an Adaptive Card to a Teams Workflows webhook URL, wrapped in the
 * message/attachments envelope Workflows expects. Workflows typically
 * responds 202 Accepted.
 */
export async function deliverCard(
  webhookUrl: string,
  card: AdaptiveCard
): Promise<DeliveryResult> {
  const envelope = {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: card,
      },
    ],
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      return { attempted: true, delivered: true, status: res.status };
    }
    const text = await res.text().catch(() => "");
    return {
      attempted: true,
      delivered: false,
      status: res.status,
      error: text.slice(0, 500),
    };
  } catch (err) {
    return { attempted: true, delivered: false, error: String(err) };
  }
}
