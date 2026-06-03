import React from 'react';

const RETICLE_STYLES = {
  photo: {
    color: 'rgba(255,255,255,0.7)',
    strokeWidth: 1,
    size: 40,
    showCrosshair: true,
    showDiamond: false,
  },
  thermal: {
    color: '#22D3EE',
    strokeWidth: 2,
    size: 56,
    showCrosshair: true,
    showDiamond: true,
  },
  night: {
    color: '#22C55E',
    strokeWidth: 1.5,
    size: 48,
    showCrosshair: true,
    showDiamond: false,
  },
  archive: {
    color: 'rgba(255,255,255,0.5)',
    strokeWidth: 1,
    size: 44,
    showCrosshair: false,
    showDiamond: true,
  },
  sweep: {
    color: '#F59E0B',
    strokeWidth: 1.5,
    size: 52,
    showCrosshair: true,
    showDiamond: false,
  },
};

export function CenterReticle({ mode = 'photo' }) {
  const style = RETICLE_STYLES[mode] || RETICLE_STYLES.photo;
  const half = style.size / 2;

  return (
    <div
      className="absolute inset-0 pointer-events-none z-[590] flex items-center justify-center"
      style={{ opacity: 0.8 }}
    >
      <svg
        width={style.size + 20}
        height={style.size + 20}
        viewBox={`0 0 ${style.size + 20} ${style.size + 20}`}
        fill="none"
        stroke={style.color}
        strokeWidth={style.strokeWidth}
      >
        <rect
          x={(20 - style.size) / 2}
          y={(20 - style.size) / 2}
          width={style.size}
          height={style.size}
          fill="none"
          opacity="0.4"
        />
        {style.showCrosshair && (
          <>
            <line x1={(20 - style.size) / 2 - 8} y1={10} x2={(20 - style.size) / 2} y2={10} />
            <line x1={(20 + style.size) / 2} y1={10} x2={(20 + style.size) / 2 + 8} y2={10} />
            <line x1={10} y1={(20 - style.size) / 2 - 8} x2={10} y2={(20 - style.size) / 2} />
            <line x1={10} y1={(20 + style.size) / 2} x2={10} y2={(20 + style.size) / 2 + 8} />
          </>
        )}
        {style.showDiamond && (
          <>
            <line x1={10} y1={10 - half - 6} x2={10 + half + 6} y2={10} />
            <line x1={10 + half + 6} y1={10} x2={10} y2={10 + half + 6} />
            <line x1={10} y1={10 + half + 6} x2={10 - half - 6} y2={10} />
            <line x1={10 - half - 6} y1={10} x2={10} y2={10 - half - 6} />
          </>
        )}
      </svg>
    </div>
  );
}