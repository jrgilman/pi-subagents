import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/agent-runner.js", async () => ({
  ...await vi.importActual<typeof import("../src/agent-runner.js")>("../src/agent-runner.js"),
  runAgent: vi.fn(),
}));

import { runAgent } from "../src/agent-runner.js";
import subagentsExtension from "../src/index.js";
import { ctx, flush, type Hermetic, hermeticDir, makePi, textOf } from "./helpers/boot-extension.js";

describe("Agent tool cwd", () => {
  let hermetic: Hermetic | undefined;
  let booted: ReturnType<typeof makePi>, context: ReturnType<typeof ctx>;

  beforeEach(() => {
    vi.mocked(runAgent).mockReset().mockResolvedValue({
      responseText: "done", session: { dispose: vi.fn() }, aborted: false, steered: false,
    } as Awaited<ReturnType<typeof runAgent>>);
  });

  afterEach(async () => {
    await flush();
    await booted?.lifecycle.get("session_shutdown")?.({}, context);
    Reflect.deleteProperty(globalThis, Symbol.for("pi-subagents:manager"));
    hermetic?.restore();
  });

  function boot(exposeCwd?: true) {
    hermetic = hermeticDir({ settings: {
      schedulingEnabled: false, outputTranscript: false, rememberAgents: false,
      ...(exposeCwd ? { exposeCwd } : {}),
    } });
    booted = makePi();
    context = ctx({ cwd: hermetic.dir });
    subagentsExtension(booted.pi);
  }

  function call(params: Record<string, unknown> = {}) {
    return booted.tools.get("Agent").execute("tc-cwd", {
      prompt: "Implement the change.", description: "Implement change",
      subagent_type: "general-purpose", ...params,
    }, undefined, undefined, context);
  }
  it("hides and rejects cwd by default", async () => {
    boot();
    expect(booted.tools.get("Agent").parameters.properties).not.toHaveProperty("cwd");
    expect(textOf(await call({ cwd: tmpdir() }))).toBe(
      "The `cwd` parameter is disabled. Set `exposeCwd: true` in subagents settings to enable it.",
    );
    expect(runAgent).not.toHaveBeenCalled();
  });
  it("advertises optional cwd semantics when enabled", () => {
    boot(true);
    const schema = booted.tools.get("Agent").parameters;
    expect(schema.required ?? []).not.toContain("cwd");
    expect(schema.properties.cwd).toMatchObject({ type: "string", description: expect.stringMatching(
      /absolute path to an existing directory.*agent's tools operate there.*parent project's `.pi` configuration remains active.*target directory's `.pi` configuration does not load.*Incompatible with resume and schedule/s,
    ) });
  });
  it.each([["foreground", false], ["background", true]] as const)("forwards cwd and the parent config directory to a %s spawn", async (_mode, run_in_background) => {
    boot(true);
    await call({ cwd: tmpdir(), run_in_background });
    await flush();
    expect(vi.mocked(runAgent).mock.lastCall![3]).toMatchObject({ cwd: tmpdir(), configCwd: hermetic!.dir });
  });
  it("preserves omitted cwd values", async () => {
    boot(true);
    await call({ run_in_background: false });
    const options = vi.mocked(runAgent).mock.lastCall![3];
    expect(options.cwd).toBeUndefined(); expect(options.configCwd).toBeUndefined();
  });
  it("rejects cwd with resume", async () => {
    boot(true);
    expect(textOf(await call({ cwd: tmpdir(), resume: "missing-agent" }))).toBe(
      "Cannot combine `cwd` with `resume` — a resumed session keeps its existing working directory.",
    );
    expect(runAgent).not.toHaveBeenCalled();
  });
});
