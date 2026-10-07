import { describe, expect, it } from "vitest";
import { isHttpUrl } from "./http-url";
import { canOpenExternally, openExternalUrl } from "./open-external-url";

describe("external URL refusal", () => {
  it.each(["mailto:person@example.com", "javascript:alert(1)", "/relative", "invalid"])(
    "safely ignores %s for fire-and-forget callers",
    async (url) => {
      await expect(openExternalUrl(url)).resolves.toBeUndefined();
    },
  );
});

describe("external URL allowlist", () => {
  it.each(["https://github.com/acme/api/pull/1", "http://localhost:4820/", "prcockpit://pr/a/b/1"])(
    "hands %s to the OS opener",
    (url) => {
      expect(canOpenExternally(url)).toBe(true);
    },
  );

  it.each(["mailto:person@example.com", "javascript:alert(1)", "paseo://settings", "/relative"])(
    "refuses %s",
    (url) => {
      expect(canOpenExternally(url)).toBe(false);
    },
  );

  it("keeps PR Cockpit links out of workspace browser tabs", () => {
    expect(isHttpUrl("prcockpit://pr/a/b/1")).toBe(false);
  });
});
