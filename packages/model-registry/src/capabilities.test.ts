import { describe, expect, it } from "vitest";
import { UnsupportedCapabilityError } from "@ai-workspace/contracts";
import {
  assertModelCapability,
  getCapabilitiesForModel,
  getModelById,
  listModels,
} from "./index.js";

describe("model-registry and capability matrix", () => {
  it("lists verified models across openai, anthropic, and google", () => {
    expect(listModels("openai").length).toBeGreaterThanOrEqual(4);
    expect(listModels("anthropic").length).toBeGreaterThanOrEqual(4);
    expect(listModels("google").length).toBeGreaterThanOrEqual(4);
  });

  it("reflects Anthropic Claude 5 temperature constraint accurately", () => {
    const claude = getModelById("claude-sonnet-5-5");
    expect(claude?.supportsTemperature).toBe(false);
    expect(claude?.capabilities.reasoningControl).toBe(true);
  });

  it("rejects unsupported capabilities explicitly", () => {
    expect(() => assertModelCapability("gpt-6-luna", "fileInput")).toThrow(
      UnsupportedCapabilityError,
    );
    expect(getCapabilitiesForModel("gpt-6.1-sol").toolCalling).toBe(true);
  });
});
