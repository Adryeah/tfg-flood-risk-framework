import React, { useState } from 'react';

export function Slider({ label, value = 0.5, min = 0, max = 1, step = 0.001, badge = null, onChange = null }) {
  const [localValue, setLocalValue] = useState(value);

  const handleChange = (e) => {
    const v = parseFloat(e.target.value);
    setLocalValue(v);
    if (onChange) onChange(v);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-12 font-medium text-text-secondary">{label}</label>
        <div className="flex items-center gap-1.5">
          <span className="text-13 font-mono font-medium text-text-primary">{localValue.toFixed(3)}</span>
          {badge && (
            <span data-role="slider-badge" className="inline-flex items-center px-1.5 py-0.5 text-10 font-medium rounded-sm bg-bg-subtle text-text-tertiary uppercase tracking-wider">
              {badge}
            </span>
          )}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={localValue}
        onChange={handleChange}
        className="w-full h-1.5 bg-bg-subtle rounded-sm appearance-none cursor-pointer accent-brand-500"
      />
    </div>
  );
}