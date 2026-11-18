import "katex/dist/katex.min.css";
import { Check, Copy } from "lucide-react";
import { useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const text = String(children ?? "").replace(/\n$/, "");
  if (!className && !text.includes("\n")) {
    return (
      <code className="rounded bg-[var(--surface-elevated)] px-1.5 py-0.5 font-mono text-[12px]">
        {children}
      </code>
    );
  }
  return (
    <div className="my-2 overflow-hidden rounded-lg border border-[var(--border)] bg-[#0d1117] text-slate-100">
      <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1 text-[11px] text-slate-400">
        <span className="font-mono uppercase">
          {className?.replace(/^language-/, "") || "text"}
        </span>
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="inline-flex items-center gap-1 cursor-pointer"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none break-words text-[var(--fg)] dark:prose-invert prose-p:my-1.5">
      <Markdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex, rehypeHighlight]}
        components={{
          code: ({ className, children }) => (
            <CodeBlock className={className}>{children}</CodeBlock>
          ),
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}
