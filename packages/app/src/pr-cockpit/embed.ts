import { z } from "zod";
import { isPullRequestKey } from "./pull-request-keys";

export const DEFAULT_PR_COCKPIT_ORIGIN = "http://127.0.0.1:4820";

const MAX_EMBED_KEYS = 100;

const PrCockpitEmbedMessageSchema = z.discriminatedUnion("type", [
  z.object({
    source: z.literal("pr-cockpit-embed"),
    type: z.literal("size"),
    height: z.number().finite().nonnegative(),
  }),
  z.object({
    source: z.literal("pr-cockpit-embed"),
    type: z.literal("open"),
    url: z.string().regex(/^prcockpit:\/\/pr\/[^/]+\/[^/]+\/\d+$/),
  }),
  z.strictObject({
    source: z.literal("pr-cockpit-embed"),
    type: z.literal("hide"),
    key: z.string().refine(isPullRequestKey),
  }),
]);

export type PrCockpitEmbedMessage = z.infer<typeof PrCockpitEmbedMessageSchema>;

export function buildPrCockpitEmbedUrl(origin: string, keys: readonly string[]): string {
  const encodedKeys = keys.slice(0, MAX_EMBED_KEYS).map(encodeURIComponent).join(",");
  return `${origin}/#/embed?overlay=1&keys=${encodedKeys}`;
}

export function parsePrCockpitEmbedMessage(value: unknown): PrCockpitEmbedMessage | null {
  const parsed = PrCockpitEmbedMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

interface PrCockpitFrameContext {
  origin: string;
  frameWindow: Window | null;
  advertisedKeys: readonly string[];
}

export function readPrCockpitFrameMessage(
  event: { origin: string; source: MessageEventSource | null; data: unknown },
  { origin, frameWindow, advertisedKeys }: PrCockpitFrameContext,
): PrCockpitEmbedMessage | null {
  const isFromFrame =
    frameWindow !== null && event.origin === origin && event.source === frameWindow;
  if (!isFromFrame) {
    return null;
  }
  const message = parsePrCockpitEmbedMessage(event.data);
  if (message?.type === "hide" && !advertisedKeys.includes(message.key)) {
    return null;
  }
  return message;
}
