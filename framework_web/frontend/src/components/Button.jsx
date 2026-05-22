import React from 'react';
import { Icon } from './Icon.jsx';

export function Button({ label, variant = 'primary', size = 'md', icon = null, onClick = null, disabled = false, type = 'button' }) {
  const sizeClasses = {
    sm: 'px-3 py-1.5 text-12 rounded',
    md: 'px-4 py-2 text-14 rounded',
    lg: 'px-5 py-2.5 text-14 rounded-md',
  };

  const variantClasses = {
    primary: 'bg-brand-700 text-white hover:bg-brand-900',
    secondary: 'bg-bg-surface text-text-primary border border-border-default hover:bg-bg-hover',
    ghost: 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
    danger: 'bg-risk-high text-white hover:bg-risk-critical',
  };

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500 disabled:opacity-50 disabled:cursor-not-allowed ${sizeClasses[size]} ${variantClasses[variant]}`}
    >
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {label && <span>{label}</span>}
    </button>
  );
}