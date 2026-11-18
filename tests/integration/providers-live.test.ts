import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "@ai-workspace/providers";

const runLive = process.env.RUN_LIVE_PROVIDER_TESTS === "1";

describe.skipIf(!runLive)("P2 controlled live provider API integration tests", () => {
  it("streams text from OpenAI if OPENAI_API_KEY is configured", async () => {
    const key = process.env.OPENAI_API_KEY;
    if (!key) return;
    const registry = new ProviderRegistry();
    let text = "";
    for await (const ev of registry.streamChat("openai", {
      modelId: "gpt-4o-mini",
      apiKey: key,
      messages: [{ role: "user", content: "Reply with OK only." }],
    })) {
      if (ev.type === "text-delta") text += ev.delta;
    }
    expect(text.toLowerCase()).toContain("ok");
  });

  it("streams text from Anthropic if ANTHROPIC_API_KEY is configured", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return;
    const registry = new ProviderRegistry();
    let text = "";
    for await (const ev of registry.streamChat("anthropic", {
      modelId: "claude-haiku-5-5",
      apiKey: key,
      messages: [{ role: "user", content: "Reply with OK only." }],
    })) {
      if (ev.type === "text-delta") text += ev.delta;
    }
    expect(text.toLowerCase()).toContain("ok");
  });

  it("streams text from Google Gemini if GEMINI_API_KEY is configured", async () => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return;
    const registry = new ProviderRegistry();
    let text = "";
    for await (const ev of registry.streamChat("google", {
      modelId: "gemini-3.5-flash-lite",
      apiKey: key,
      messages: [{ role: "user", content: "Reply with OK only." }],
    })) {
      if (ev.type === "text-delta") text += ev.delta;
    }
    expect(text.toLowerCase()).toContain("ok");
  });
});
