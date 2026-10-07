import { describe, expect, it } from "vitest";

import { createExternalUrlOpener } from "./opener";

describe("desktop opener", () => {
  it("passes a canonical web URL to its external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    await open("https://example.com/docs#install");

    expect(opened).toEqual(["https://example.com/docs#install"]);
  });

  it("passes a PR Cockpit pull request URL to its external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    await open("prcockpit://pr/acme/api/12");

    expect(opened).toEqual(["prcockpit://pr/acme/api/12"]);
  });

  it("does not hand other or relative URLs to the external owner", async () => {
    const opened: string[] = [];
    const open = createExternalUrlOpener({
      open: async (url) => {
        opened.push(url);
      },
    });

    for (const input of [
      "file:///private/data",
      "javascript:alert(1)",
      "paseo://settings",
      "/docs",
      null,
    ]) {
      await expect(open(input)).rejects.toThrow(
        "Only HTTP(S) and PR Cockpit URLs can open externally.",
      );
    }

    expect(opened).toEqual([]);
  });
});
