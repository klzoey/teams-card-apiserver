import { AdaptiveCard } from "./teams/card";
import { deliverCard, DeliveryResult } from "./teams/deliver";
import { getTeamsWebhookUrl } from "./teams/routing";
import { getTranslator } from "./translators";
import { saveCardJson } from "./capture";

export interface PipelineResult {
  card: AdaptiveCard | null;
  /** Where the translated card was saved (relative to capture dir), if any. */
  cardFile?: string;
  delivery: DeliveryResult;
}

/**
 * Translate a captured webhook body into an Adaptive Card and forward it to
 * the Teams webhook configured for the service. Capture has already happened
 * by the time this runs — a translation or delivery failure never loses data.
 */
export async function translateAndDeliver(
  service: string,
  eventType: string,
  body: unknown,
  captureFile?: string
): Promise<PipelineResult> {
  let card: AdaptiveCard | null = null;
  try {
    card = await getTranslator(service)(body, { service, eventType });
  } catch (err) {
    return {
      card: null,
      delivery: { attempted: false, reason: `translator threw: ${err}` },
    };
  }

  if (!card) {
    return {
      card: null,
      delivery: { attempted: false, reason: "translator produced no card for this event" },
    };
  }

  let cardFile: string | undefined;
  if (captureFile) {
    try {
      cardFile = await saveCardJson(captureFile, card);
    } catch (err) {
      console.warn(`saving card preview failed, continuing with delivery: ${err}`);
    }
  }

  const webhookUrl = getTeamsWebhookUrl(service);
  if (!webhookUrl) {
    return {
      card,
      cardFile,
      delivery: {
        attempted: false,
        reason:
          `no Teams webhook configured for '${service}' — add it to ` +
          `teams-webhooks.json or set TEAMS_WEBHOOK_${service.toUpperCase()}`,
      },
    };
  }

  return { card, cardFile, delivery: await deliverCard(webhookUrl, card) };
}
