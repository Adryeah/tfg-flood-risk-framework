import React from 'react';

export function Card({ title, subtitle, actions, body, className = '', bodyPadding = 'p-4' }) {
  return (
    <div className={`bg-bg-surface border border-border-default rounded shadow-sm transition-colors hover:border-border-strong ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-default">
          {title && (
            <div>
              <h3 className="text-13 font-semibold text-text-primary tracking-tight">{title}</h3>
              {subtitle && <p className="text-11 text-text-tertiary mt-0.5">{subtitle}</p>}
            </div>
          )}
          {actions && <div>{actions}</div>}
        </div>
      )}
      {body && (
        <div className={bodyPadding}>
          {typeof body === 'string' ? <div dangerouslySetInnerHTML={{ __html: body }} /> : body}
        </div>
      )}
    </div>
  );
}