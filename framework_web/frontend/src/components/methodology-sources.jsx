import React from 'react';
import { BookOpen } from 'lucide-react';
import {
  Card,
  CardContent,
} from '@/components/ui/card';

/**
 * Methodology references panel for the bottom of each Methodology view.
 *
 * Reads as a "Bibliography" footer in a scientific paper: lists the
 * primary sources behind the metrics and the design conventions shown
 * on the page. Each row has author/year + a short note about how the
 * source is used (which metric, which chart).
 *
 * Props:
 *   - title (default: "Sources & methodology references")
 *   - items: array of { author, year, work, used_for }
 */
export function MethodologySources({
  title = 'Sources & methodology references',
  items,
}) {
  if (!items || items.length === 0) return null;
  return (
    <Card>
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-2 mb-2.5">
          <BookOpen
            className="w-3.5 h-3.5 text-text-tertiary"
            strokeWidth={1.75}
          />
          <span className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider">
            {title}
          </span>
        </div>
        <ul className="space-y-1.5">
          {items.map((it, idx) => (
            <li
              key={idx}
              className="text-11 text-text-secondary leading-relaxed grid grid-cols-[auto_1fr] gap-x-3 items-baseline"
            >
              <span className="font-mono text-text-primary whitespace-nowrap tabular-nums">
                {it.author} {it.year}
              </span>
              <span className="min-w-0">
                <span className="italic">{it.work}</span>
                {it.used_for && (
                  <>
                    <span className="text-text-tertiary"> — </span>
                    <span>{it.used_for}</span>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
