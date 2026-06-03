export const shaderArchive = `
float rand(vec2 co) {
  return fract(sin(dot(co.xy, vec2(12.9898, 78.233))) * 43758.5453);
}

vec4 applyArchive(vec4 color, vec2 uv) {
  float scan = mod(gl_FragCoord.y, 2.0) < 1.0 ? 0.85 : 1.0;
  vec2 centered = uv - 0.5;
  float vig = 1.0 - dot(centered, centered) * 1.4;
  float n = rand(uv) * 0.05;
  vec3 col = color.rgb * scan * max(vig, 0.3) + n;
  col = mix(col, vec3(0.06, 0.11, 0.21), 0.12);
  return vec4(col, color.a);
}
`;