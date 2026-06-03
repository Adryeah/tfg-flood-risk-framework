import { shaderThermal } from './shader-thermal.js';
import { shaderNight } from './shader-night.js';
import { shaderArchive } from './shader-archive.js';

export function createPostProcessEffect(mode) {
  if (mode === 'thermal') {
    return {
      name: 'ThermalEffect',
      uniforms: {},
      fs: shaderThermal,
    };
  }
  if (mode === 'night') {
    return {
      name: 'NightEffect',
      uniforms: {},
      fs: shaderNight,
    };
  }
  if (mode === 'archive') {
    return {
      name: 'ArchiveEffect',
      uniforms: {},
      fs: shaderArchive,
    };
  }
  return null;
}

export function getShaderCssFilter(mode) {
  switch (mode) {
    case 'thermal':
      return 'saturate(2.2) sepia(0.8) hue-rotate(-10deg) contrast(1.1)';
    case 'night':
      return 'saturate(0) brightness(0.85) contrast(1.15)';
    case 'archive':
      return 'contrast(1.15) brightness(0.92) saturate(0.9)';
    default:
      return 'none';
  }
}