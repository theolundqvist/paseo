import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePrCockpitOrigin } from "./pr-cockpit.js";

const homes: string[] = [];

async function environment(config?: string) {
  const home = await mkdtemp(path.join(os.tmpdir(), "paseo-cockpit-origin-"));
  homes.push(home);
  if (config !== undefined) {
    const directory = path.join(home, ".config", "pr-cockpit");
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "config"), config);
  }
  return { PATH: process.env.PATH, HOME: home };
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

describe.skipIf(process.platform === "win32")("resolvePrCockpitOrigin", () => {
  it("uses the launcher default without config", async () => {
    await expect(resolvePrCockpitOrigin(await environment())).resolves.toBe(
      "http://127.0.0.1:4820",
    );
  });

  it("sources shell config, including quoted/exported values and the final assignment", async () => {
    const env = await environment(
      '# COCKPIT_PORT=4800\nCOCKPIT_PORT=4821\nexport COCKPIT_PORT="4825"\n',
    );
    await expect(resolvePrCockpitOrigin(env)).resolves.toBe("http://127.0.0.1:4825");
  });

  it("preserves an explicit environment port over config", async () => {
    const env = await environment("COCKPIT_PORT=4825\n");
    await expect(resolvePrCockpitOrigin({ ...env, COCKPIT_PORT: "4920" })).resolves.toBe(
      "http://127.0.0.1:4920",
    );
  });

  it("treats an empty environment value as unset, like the launcher", async () => {
    const env = await environment("COCKPIT_PORT=4825\n");
    await expect(resolvePrCockpitOrigin({ ...env, COCKPIT_PORT: "" })).resolves.toBe(
      "http://127.0.0.1:4825",
    );
  });

  it("uses the default for an empty config port", async () => {
    await expect(resolvePrCockpitOrigin(await environment('COCKPIT_PORT=""\n'))).resolves.toBe(
      "http://127.0.0.1:4820",
    );
  });

  it("canonicalizes the default HTTP port for iframe message validation", async () => {
    await expect(resolvePrCockpitOrigin(await environment("COCKPIT_PORT=80\n"))).resolves.toBe(
      "http://127.0.0.1",
    );
  });

  it("does not guess another origin for an invalid configured port", async () => {
    await expect(
      resolvePrCockpitOrigin(await environment("COCKPIT_PORT=not-a-port\n")),
    ).rejects.toThrow("COCKPIT_PORT");
  });

  it.skipIf(process.platform !== "linux")(
    "honors the launcher's Linux XDG config path",
    async () => {
      const env = await environment("COCKPIT_PORT=4825\n");
      const configRoot = path.join(env.HOME, "xdg");
      await mkdir(path.join(configRoot, "pr-cockpit"), { recursive: true });
      await writeFile(path.join(configRoot, "pr-cockpit", "config"), "COCKPIT_PORT=4925\n");
      await expect(resolvePrCockpitOrigin({ ...env, XDG_CONFIG_HOME: configRoot })).resolves.toBe(
        "http://127.0.0.1:4925",
      );
    },
  );
});
