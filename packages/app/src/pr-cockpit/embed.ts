import { z } from "zod";

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
]);

export type PrCockpitEmbedMessage = z.infer<typeof PrCockpitEmbedMessageSchema>;

export function buildPrCockpitEmbedUrl(origin: string, keys: readonly string[]): string {
  const encodedKeys = keys.slice(0, MAX_EMBED_KEYS).map(encodeURIComponent).join(",");
  return `${origin}/#/embed?keys=${encodedKeys}`;
}

export function parsePrCockpitEmbedMessage(value: unknown): PrCockpitEmbedMessage | null {
  const parsed = PrCockpitEmbedMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
