import { validateOutboundUrl } from "@ai-workspace/shared";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Builds Chat-mode tools (strictly NO OS shell or host filesystem access).
 */
export function buildChatTools(options: { enableWebSearch?: boolean } = {}): ToolSet {
  const tools: ToolSet = {
    get_current_time: tool({
      description: "Get the current UTC date and time in ISO-8601 format.",
      inputSchema: z.object({}),
      execute: async () => ({
        utcIso: new Date().toISOString(),
      }),
    }),
  };

  if (options.enableWebSearch) {
    tools.fetch_webpage = tool({
      description:
        "Fetch plain text summary from a public HTTPS webpage URL. Internal/private IPs are blocked.",
      inputSchema: z.object({
        url: z.string().url().describe("Public HTTP(S) URL to inspect"),
      }),
      execute: async ({ url }) => {
        const checked = validateOutboundUrl(url);
        if (!checked.ok) {
          return { ok: false, error: checked.reason };
        }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 8_000);
          const res = await fetch(checked.url.toString(), {
            method: "GET",
            headers: { "User-Agent": "EpoCanvas-ChatBot/0.1" },
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (!res.ok) {
            return { ok: false, status: res.status, error: `HTTP ${res.status}` };
          }
          const text = (await res.text()).slice(0, 6_000);
          return { ok: true, url: checked.url.toString(), excerpt: text };
        } catch (err) {
          return {
            ok: false,
            error: err instanceof Error ? err.message : "Failed to fetch URL",
          };
        }
      },
    });
  }

  return tools;
}
