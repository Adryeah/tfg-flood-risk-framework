import React from 'react';

export function Loading({ message = 'Loading...' }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center p-12 text-text-secondary">
      <div className="w-8 h-8 border-2 border-border-default border-t-brand-500 rounded-full animate-spin mb-4" />
      <p className="text-14">{message}</p>
    </div>
  );
}