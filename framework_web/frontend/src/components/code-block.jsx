import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

/**
 * Stripe/Bloomberg-style code block. Used by the Leakage Audit view
 * to surface the actual buggy Python line so the audit reads like a
 * post-mortem rather than narrative prose.
 *
 * - Header: caption (filename:line) + optional severity badge + copy
 * - Body: monospace, horizontal scroll, line breaks preserved
 */
export default function CodeBlock({
  code,
  language = 'python', // currently informational only — no highlight engine
  caption = null,
  badge = null,
  showCopy = true,
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard may be blocked by browser permissions — silently ignore */
    }
  };

  return (
    <div
      className="border border-border-default rounded-md overflow-hidden bg-bg-subtle"
      data-language={language}
    >
      {(caption || badge || showCopy) && (
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-default bg-bg-surface">
          <div className="flex items-center gap-2 min-w-0">
            {caption && (
              <span className="text-12 font-mono text-text-secondary truncate">
                {caption}
              </span>
            )}
            {badge && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-10 font-mono font-semibold rounded-sm bg-risk-high-bg text-risk-high uppercase tracking-wider shrink-0">
                {badge}
              </span>
            )}
          </div>
          {showCopy && (
            <button
              type="button"
              onClick={copy}
              className="text-text-tertiary hover:text-text-primary transition-colors shrink-0"
              title="Copy code"
              aria-label="Copy code"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      )}
      <pre className="p-3 overflow-x-auto">
        <code className="text-12 font-mono text-text-primary leading-relaxed whitespace-pre">
          {code}
        </code>
      </pre>
    </div>
  );
}
