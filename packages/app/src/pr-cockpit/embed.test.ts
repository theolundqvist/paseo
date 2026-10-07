import { describe, expect, it } from "vitest";
import { buildPrCockpitEmbedUrl, parsePrCockpitEmbedMessage } from "./embed";

describe("buildPrCockpitEmbedUrl", () => {
  it("encodes each key and keeps the given order", () => {
    expect(buildPrCockpitEmbedUrl(["acme/api#12", "acme/web#3"])).toBe(
      "http://localhost:4820/#/embed?keys=acme%2Fapi%2312,acme%2Fweb%233",
    );
  });

  it("sends at most 100 keys", () => {
    const keys = Array.from({ length: 120 }, (_, index) => `acme/api#${index + 1}`);
    const query = buildPrCockpitEmbedUrl(keys).split("keys=")[1] ?? "";
    expect(query.split(",")).toHaveLength(100);
  });
});

describe("parsePrCockpitEmbedMessage", () => {
  it("reads size messages", () => {
    expect(
      parsePrCockpitEmbedMessage({ source: "pr-cockpit-embed", type: "size", height: 120.5 }),
    ).toEqual({ source: "pr-cockpit-embed", type: "size", height: 120.5 });
    expect(
      parsePrCockpitEmbedMessage({ source: "pr-cockpit-embed", type: "size", height: 0 }),
    ).toEqual({ source: "pr-cockpit-embed", type: "size", height: 0 });
  });

  it("reads open messages for PR Cockpit pull request URLs", () => {
    expect(
      parsePrCockpitEmbedMessage({
        source: "pr-cockpit-embed",
        type: "open",
        url: "prcockpit://pr/acme/api/12",
      }),
    ).toEqual({ source: "pr-cockpit-embed", type: "open", url: "prcockpit://pr/acme/api/12" });
  });

  it.each([
    null,
    "size",
    { type: "size", height: 10 },
    { source: "other", type: "size", height: 10 },
    { source: "pr-cockpit-embed", type: "size", height: -1 },
    { source: "pr-cockpit-embed", type: "size", height: Number.NaN },
    { source: "pr-cockpit-embed", type: "size", height: "10" },
    { source: "pr-cockpit-embed", type: "open", url: "https://github.com/acme/api/pull/12" },
    { source: "pr-cockpit-embed", type: "open", url: "prcockpit://pr/acme/api/12/files" },
    { source: "pr-cockpit-embed", type: "open", url: "prcockpit://settings" },
    { source: "pr-cockpit-embed", type: "open", url: "javascript:alert(1)//prcockpit://pr/a/b/1" },
    { source: "pr-cockpit-embed", type: "navigate", url: "prcockpit://pr/acme/api/12" },
  ])("rejects %j", (value) => {
    expect(parsePrCockpitEmbedMessage(value)).toBeNull();
  });
});
