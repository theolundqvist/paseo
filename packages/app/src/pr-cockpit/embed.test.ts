/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import {
  buildPrCockpitEmbedUrl,
  parsePrCockpitEmbedMessage,
  readPrCockpitFrameMessage,
} from "./embed";

describe("buildPrCockpitEmbedUrl", () => {
  it("encodes each key and keeps the given order", () => {
    expect(buildPrCockpitEmbedUrl("http://127.0.0.1:4825", ["acme/api#12", "acme/web#3"])).toBe(
      "http://127.0.0.1:4825/#/embed?overlay=1&keys=acme%2Fapi%2312,acme%2Fweb%233",
    );
  });

  it("sends at most 100 keys", () => {
    const keys = Array.from({ length: 120 }, (_, index) => `acme/api#${index + 1}`);
    const query = buildPrCockpitEmbedUrl("http://127.0.0.1:4820", keys).split("keys=")[1] ?? "";
    expect(query.split(",")).toHaveLength(100);
  });
});

describe("parsePrCockpitEmbedMessage", () => {
  it("reads size messages", () => {
    expect(
      parsePrCockpitEmbedMessage({
        source: "pr-cockpit-embed",
        type: "size",
        height: 120.5,
      }),
    ).toEqual({ source: "pr-cockpit-embed", type: "size", height: 120.5 });
    expect(
      parsePrCockpitEmbedMessage({
        source: "pr-cockpit-embed",
        type: "size",
        height: 0,
      }),
    ).toEqual({ source: "pr-cockpit-embed", type: "size", height: 0 });
  });

  it("reads open messages for PR Cockpit pull request URLs", () => {
    expect(
      parsePrCockpitEmbedMessage({
        source: "pr-cockpit-embed",
        type: "open",
        url: "prcockpit://pr/acme/api/12",
      }),
    ).toEqual({
      source: "pr-cockpit-embed",
      type: "open",
      url: "prcockpit://pr/acme/api/12",
    });
  });

  it("reads an exact local-hide request", () => {
    expect(
      parsePrCockpitEmbedMessage({
        source: "pr-cockpit-embed",
        type: "hide",
        key: "acme/api#12",
      }),
    ).toEqual({ source: "pr-cockpit-embed", type: "hide", key: "acme/api#12" });
  });

  it.each([
    null,
    "size",
    { type: "size", height: 10 },
    { source: "other", type: "size", height: 10 },
    { source: "pr-cockpit-embed", type: "size", height: -1 },
    { source: "pr-cockpit-embed", type: "size", height: Number.NaN },
    { source: "pr-cockpit-embed", type: "size", height: "10" },
    {
      source: "pr-cockpit-embed",
      type: "open",
      url: "https://github.com/acme/api/pull/12",
    },
    {
      source: "pr-cockpit-embed",
      type: "open",
      url: "prcockpit://pr/acme/api/12/files",
    },
    { source: "pr-cockpit-embed", type: "open", url: "prcockpit://settings" },
    {
      source: "pr-cockpit-embed",
      type: "open",
      url: "javascript:alert(1)//prcockpit://pr/a/b/1",
    },
    {
      source: "pr-cockpit-embed",
      type: "navigate",
      url: "prcockpit://pr/acme/api/12",
    },
    { source: "other", type: "hide", key: "acme/api#12" },
    { source: "pr-cockpit-embed", type: "hide" },
    { source: "pr-cockpit-embed", type: "hide", key: 12 },
    {
      source: "pr-cockpit-embed",
      type: "hide",
      key: "https://github.com/acme/api/pull/12",
    },
    { source: "pr-cockpit-embed", type: "hide", key: "acme/api#0" },
    { source: "pr-cockpit-embed", type: "hide", key: "acme/api#012" },
    { source: "pr-cockpit-embed", type: "hide", key: "acme/..#12" },
    { source: "pr-cockpit-embed", type: "hide", key: "acme/api#12\n" },
    {
      source: "pr-cockpit-embed",
      type: "hide",
      key: "acme/api#12",
      archive: true,
    },
  ])("rejects %j", (value) => {
    expect(parsePrCockpitEmbedMessage(value)).toBeNull();
  });
});

describe("readPrCockpitFrameMessage", () => {
  it("accepts a hide only from the configured origin and exact advertising frame", () => {
    const frame = document.createElement("iframe");
    const sibling = document.createElement("iframe");
    document.body.append(frame, sibling);
    const context = {
      origin: "http://127.0.0.1:4825",
      frameWindow: frame.contentWindow,
      advertisedKeys: ["acme/api#12"],
    };
    const data = {
      source: "pr-cockpit-embed",
      type: "hide",
      key: "acme/api#12",
    };
    const event = { origin: context.origin, source: frame.contentWindow, data };

    expect(readPrCockpitFrameMessage(event, context)).toEqual(data);
    expect(
      readPrCockpitFrameMessage({ ...event, origin: "http://127.0.0.1:4820" }, context),
    ).toBeNull();
    expect(readPrCockpitFrameMessage({ ...event, origin: "null" }, context)).toBeNull();
    expect(
      readPrCockpitFrameMessage({ ...event, source: sibling.contentWindow }, context),
    ).toBeNull();
    expect(readPrCockpitFrameMessage({ ...event, source: null }, context)).toBeNull();
    expect(readPrCockpitFrameMessage(event, { ...context, frameWindow: null })).toBeNull();
    expect(
      readPrCockpitFrameMessage(event, {
        ...context,
        advertisedKeys: ["acme/api#1"],
      }),
    ).toBeNull();
    expect(
      readPrCockpitFrameMessage({ ...event, data: { ...data, key: "acme/api#13" } }, context),
    ).toBeNull();
    expect(
      readPrCockpitFrameMessage({ ...event, data: { ...data, archive: true } }, context),
    ).toBeNull();
    frame.remove();
    sibling.remove();
  });

  it("keeps the existing size and open contracts for the trusted frame", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const context = {
      origin: "http://127.0.0.1:4825",
      frameWindow: frame.contentWindow,
      advertisedKeys: [],
    };
    for (const data of [
      { source: "pr-cockpit-embed", type: "size", height: 32 },
      {
        source: "pr-cockpit-embed",
        type: "open",
        url: "prcockpit://pr/acme/api/12",
      },
    ]) {
      expect(
        readPrCockpitFrameMessage(
          {
            origin: context.origin,
            source: frame.contentWindow,
            data,
          },
          context,
        ),
      ).toEqual(data);
    }
    frame.remove();
  });
});
