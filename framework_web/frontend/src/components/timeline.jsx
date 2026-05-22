import React from 'react';
import { cn } from '@/lib/utils';
import { Check, X, AlertTriangle } from 'lucide-react';

/**
 * Vertical 4-phase timeline used by the Leakage Audit case study.
 *
 * Each phase: { label, title, content, status }
 * status ∈ {undefined, 'pass', 'fail', 'warning'}
 *   - undefined → numeric badge
 *   - pass → green check
 *   - fail → red X
 *   - warning → amber triangle
 *
 * The connecting line is rendered as a 1px column between dots; the last
 * phase has no trailing line so the timeline ends cleanly.
 *
 * `content` can be a string or a React node (for the audit we pass nodes
 * with embedded code spans, lists, etc.).
 */
export default function Timeline({ phases }) {
  return (
    <div className="relative">
      {phases.map((phase, idx) => {
        const status = phase.status;
        const isLast = idx === phases.length - 1;

        return (
          <div key={idx} className="flex gap-4 pb-6 last:pb-0">
            {/* DOT + connector */}
            <div className="flex flex-col items-center flex-shrink-0">
              <div
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center border-2 z-10',
                  status === 'pass' &&
                    'bg-risk-low-bg border-risk-low text-risk-low',
                  status === 'fail' &&
                    'bg-risk-high-bg border-risk-high text-risk-high',
                  status === 'warning' &&
                    'bg-risk-medium-bg border-risk-medium text-risk-medium',
                  !status &&
                    'bg-bg-surface border-border-strong text-text-secondary'
                )}
              >
                {status === 'pass' && (
                  <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
                )}
                {status === 'fail' && (
                  <X className="w-3.5 h-3.5" strokeWidth={2.5} />
                )}
                {status === 'warning' && (
                  <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
                )}
                {!status && (
                  <span className="text-11 font-mono font-semibold">
                    {idx + 1}
                  </span>
                )}
              </div>
              {!isLast && (
                <div className="w-px flex-1 bg-border-default mt-1"></div>
              )}
            </div>

            {/* CONTENT */}
            <div className="flex-1 pb-2 min-w-0">
              {phase.label && (
                <div className="text-11 font-mono font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                  {phase.label}
                </div>
              )}
              <h3 className="text-16 font-semibold text-text-primary mb-2">
                {phase.title}
              </h3>
              <div className="text-13 text-text-secondary leading-relaxed">
                {phase.content}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
