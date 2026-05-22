import React from 'react';

export function Badge({ label, variant = 'default' }) {
  const variantClasses = {
    default: 'bg-bg-subtle text-text-secondary',
    'risk-low': 'bg-risk-low-bg text-risk-low',
    'risk-medium': 'bg-risk-medium-bg text-risk-medium',
    'risk-high': 'bg-risk-high-bg text-risk-high',
    brand: 'bg-brand-50 text-brand-700',
    info: 'bg-brand-50 text-brand-700',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-11 font-medium rounded-sm ${variantClasses[variant] || variantClasses.default}`}>
      {label}
    </span>
  );
}