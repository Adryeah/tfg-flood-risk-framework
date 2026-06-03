export const shaderNight = `
vec4 applyNight(vec4 color) {
  float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float q = floor(lum * 4.0) / 4.0;
  vec3 green = vec3(0.08, q * 1.2, 0.10);
  return vec4(green, color.a);
}
`;