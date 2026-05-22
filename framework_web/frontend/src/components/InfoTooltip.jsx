import React, { useState, useId, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon.jsx';

/**
 * Small (i) icon → "What / Source" popover on hover or focus.
 *
 * Rendered via React Portal to document.body so the popover ESCAPES any
 * ancestor with `overflow: hidden` (KPI card severity ribbons, chart card
 * chrome, etc.). The previous in-tree mount would get clipped at the card
 * boundary — the long sentences in info popovers needed somewhere to bleed.
 *
 * Animation (emil-design-eng):
 *   • Always-mounted via Portal; data-state="open|closed" + CSS transition.
 *   • Enter from scale(0.96) + opacity 0 (never scale(0) — emil "Real-world
 *     objects don't materialise from zero").
 *   • transform-origin computed from anchor: top-right corner of the
 *     popover aligned with the (i) icon's bottom-right, so it grows out of
 *     the trigger.
 *   • 130 ms cubic-bezier(0.23, 1, 0.32, 1) — punchy ease-out.
 *   • Hide is pointer-events:none + opacity 0, no scale-down on exit.
 *
 * Positioning recomputes on scroll/resize so the popover follows its anchor.
 */
export function InfoTooltip({ what, source }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const id = useId();

  const show = () => setOpen(true);
  const hide = () => setOpen(false);
  const toggle = () => setOpen((v) => !v);

  // Recompute position when opening, scrolling, or resizing.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const compute = () => {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      // Anchor the popover so its TOP-RIGHT corner aligns to the (i)
      // icon's BOTTOM-RIGHT corner (+ 6 px gap). Then if it would
      // overflow the left edge of the viewport, clamp left to 8 px.
      const popW = 288; // matches w-72
      const gap = 6;
      let left = r.right - popW;
      const top = r.bottom + gap;
      if (left < 8) left = 8;
      setPos({ top, left });
    };

    compute();
    const onScroll = () => compute();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  // Close on Escape — accessibility nicety.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <span
        className="relative inline-flex items-center"
        onMouseEnter={show}
        onMouseLeave={hide}
      >
        <button
          ref={triggerRef}
          type="button"
          aria-label="About this metric"
          aria-expanded={open}
          aria-controls={id}
          onFocus={show}
          onBlur={hide}
          onClick={toggle}
          className="w-4 h-4 inline-flex items-center justify-center rounded-full text-text-tertiary hover:text-text-primary hover:bg-bg-subtle focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <Icon name="info" size={12} />
        </button>
      </span>

      {/* Portal mount — escapes any ancestor overflow:hidden. */}
      {createPortal(
        <div
          ref={popoverRef}
          id={id}
          role="tooltip"
          data-state={open ? 'open' : 'closed'}
          aria-hidden={!open}
          onMouseEnter={show}
          onMouseLeave={hide}
          className="fixed w-72 bg-bg-surface border border-border-default rounded-md shadow-md p-3 text-12 leading-relaxed text-text-secondary z-[2000]"
          style={{
            top: `${pos.top}px`,
            left: `${pos.left}px`,
            transformOrigin: 'top right',
            transition:
              'opacity 130ms cubic-bezier(0.23, 1, 0.32, 1), transform 130ms cubic-bezier(0.23, 1, 0.32, 1)',
            opacity: open ? 1 : 0,
            transform: open ? 'scale(1)' : 'scale(0.96)',
            pointerEvents: open ? 'auto' : 'none',
          }}
        >
          {what && (
            <div className="mb-2">
              <div className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                What
              </div>
              <p className="text-text-primary">{what}</p>
            </div>
          )}
          {source && (
            <div>
              <div className="text-10 font-mono font-semibold text-text-tertiary uppercase tracking-wider mb-1">
                Source
              </div>
              <p className="font-mono text-11 text-text-secondary break-words">{source}</p>
            </div>
          )}
        </div>,
        document.body
      )}
    </>
  );
}
