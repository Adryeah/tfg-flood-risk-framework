export const shaderThermal = `
vec3 thermalLUT(float t) {
  vec3 c1 = vec3(0.07, 0.05, 0.30);
  vec3 c2 = vec3(0.00, 0.85, 0.95);
  vec3 c3 = vec3(1.00, 0.85, 0.10);
  vec3 c4 = vec3(1.00, 0.20, 0.05);
  vec3 c5 = vec3(1.00, 1.00, 0.95);
  if (t < 0.25) return mix(c1, c2, t * 4.0);
  if (t < 0.50) return mix(c2, c3, (t - 0.25) * 4.0);
  if (t < 0.75) return mix(c3, c4, (t - 0.50) * 4.0);
  return mix(c4, c5, (t - 0.75) * 4.0);
}

vec4 applyThermal(vec4 color) {
  float luminance = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  vec3 thermal = thermalLUT(luminance);
  return vec4(thermal, color.a);
}
`;