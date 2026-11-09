/**
 * The hero's vault door, ray-marched: a round bank-vault door in a concrete wall, swung on a hinge, with a
 * brass wheel, thrown bolts and a vault of safe-deposit boxes and gold bars behind it. Everything is a signed
 * distance field, so the wheel can spin, the bolts retract and the door swing open from scroll alone.
 *
 * Uniforms: uWheel (rad), uBolt (0 thrown → 1 retracted), uOpen (door swing, rad), uCam (0 resting shot →
 * 1 inside the vault), uFrame (x: where the door sits on screen, y: zoom), uTilt (pointer parallax).
 */
export const VAULT_DOOR_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;
uniform float uWheel;   // wheel angle (rad)
uniform float uBolt;    // 0 bolts thrown, 1 retracted
uniform float uOpen;    // door swing (rad)
uniform float uCam;     // 0 resting shot, 1 inside the vault
uniform vec3 uFrame;    // x: horizontal offset of the door on screen, y: zoom, z: vertical offset
uniform vec2 uTilt;     // pointer parallax

const float PI = 3.14159265;
const float TAU = 6.2831853;

// ---- geometry constants (wall face at z = 0, opening radius 1) ----
const float RO = 1.0;          // opening
const float DR = 0.975;        // door radius
const float DZ0 = -0.36;       // door back
const float DZ1 = 0.16;        // door front
const vec3 HINGE = vec3(1.34, 0.0, 0.34);
const float TUNNEL = 4.2;

const vec3 GOLD = vec3(1.0, 0.66, 0.24);
const vec3 BRASS = vec3(0.92, 0.70, 0.40);
const vec3 STEEL = vec3(0.62, 0.63, 0.65);

float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdRBox(vec3 p, vec3 b, float r) { return sdBox(p, b - r) - r; }
float sdRect2(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
float sdTorusZ(vec3 p, float R, float r) { return length(vec2(length(p.xy) - R, p.z)) - r; }
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return length(pa - ba * h) - r; }
// cylinder along z: radius r, z in [z0, z1], edge rounding e
float sdCylZ(vec3 p, float r, float z0, float z1, float e) {
  vec2 d = vec2(length(p.xy) - r + e, abs(p.z - 0.5 * (z0 + z1)) - 0.5 * (z1 - z0) + e);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)) - e;
}
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }

// materials: 1 wall, 2 frame, 3 door steel, 4 brass, 5 bolt chrome, 6 tunnel, 7 gold bars, 8 hinge (dark steel)
vec2 opU(vec2 a, vec2 b) { return a.x < b.x ? a : b; }

// door in its own closed frame (axis z, centred at origin in xy)
vec2 door(vec3 q) {
  float r = length(q.xy);
  // bound: cheap early out
  float bound = sdCylZ(q, DR + 0.24, DZ0 - 0.02, 0.62, 0.0);
  if (bound > 0.25) return vec2(bound, 3.0);

  // body: plug with a stepped face (outer band proud, inner field recessed)
  float body = sdCylZ(q, DR, DZ0, DZ1, 0.018);
  float field = sdCylZ(q, 0.78, DZ1 - 0.035, DZ1 + 0.2, 0.012);
  body = max(body, -field);
  // concentric lathe grooves cut into the field
  float dr = abs(fract(r * 9.0 + 0.5) - 0.5) / 9.0;
  float cutter = max(dr - 0.0035, (DZ1 - 0.035 - 0.007) - q.z);
  cutter = max(cutter, max(r - 0.74, 0.24 - r));
  body = max(body, -cutter);
  vec2 res = vec2(body, 3.0);

  // rivets on the outer band
  {
    float a = atan(q.y, q.x);
    float n = 28.0;
    float la = mod(a + PI / n, TAU / n) - PI / n;
    vec2 rp = vec2(cos(la), sin(la)) * r;
    float riv = length(vec3(rp.x - 0.885, rp.y, q.z - DZ1)) - 0.026;
    res = opU(res, vec2(riv, 5.0));
  }

  // hub
  float hub = sdCylZ(q, 0.19, DZ1 - 0.04, DZ1 + 0.16, 0.02);
  hub = min(hub, sdCylZ(q, 0.13, DZ1 + 0.1, DZ1 + 0.24, 0.025));
  res = opU(res, vec2(hub, 3.5));

  // wheel: rim, spokes and handles, spinning about z
  {
    vec3 w = q;
    w.xy = rot(uWheel) * w.xy;
    float zc = DZ1 + 0.2;
    float rim = sdTorusZ(w - vec3(0, 0, zc), 0.5, 0.032);
    float a = atan(w.y, w.x);
    float n = 5.0;
    float la = mod(a + PI / n, TAU / n) - PI / n;
    vec2 sp = vec2(cos(la), sin(la)) * length(w.xy);
    vec3 s3 = vec3(sp, w.z);
    float spoke = sdCapsule(s3, vec3(0.1, 0, zc), vec3(0.62, 0, zc), 0.026);
    float knob = length(s3 - vec3(0.69, 0, zc)) - 0.055;
    knob = smin(knob, sdCapsule(s3, vec3(0.6, 0, zc), vec3(0.67, 0, zc), 0.036), 0.03);
    float cap = sdCylZ(w, 0.1, DZ1 + 0.18, DZ1 + 0.28, 0.03);
    float wheel = min(min(rim, spoke), min(knob, cap));
    res = opU(res, vec2(wheel, 4.0));
  }

  // locking bolts round the edge: thrown into the frame, or retracted into the door
  {
    float a = atan(q.y, q.x);
    float n = 12.0;
    float la = mod(a + PI / n, TAU / n) - PI / n;
    vec2 bp = vec2(cos(la), sin(la)) * r;
    float ext = mix(0.2, -0.1, uBolt);
    float zb = 0.5 * (DZ0 + DZ1);
    float bolt = sdCapsule(vec3(bp, q.z), vec3(0.85, 0, zb), vec3(DR + ext, 0, zb), 0.06);
    res = opU(res, vec2(bolt, 5.0));
  }
  return res;
}

vec2 map(vec3 p) {
  float r = length(p.xy);
  // wall with a round tunnel, and a back wall
  float wall = min(max(p.z, RO - r), p.z + TUNNEL);
  vec2 res = vec2(wall, r < RO + 0.001 ? 6.0 : 1.0);
  // flat floor inside the vault
  res = opU(res, vec2(max(max(p.y + 0.62, p.z), r - RO - 0.02), 6.0));

  // frame ring proud of the wall
  float fr = sdRect2(vec2(r - 1.2, p.z - 0.05), vec2(0.2, 0.05), 0.02);
  fr = max(fr, -(r - RO));
  res = opU(res, vec2(fr, 2.0));

  // gold bars stacked at the back of the vault
  {
    vec3 b = p - vec3(0.0, -0.62, -TUNNEL + 0.9);
    float bars = 1e9;
    for (int row = 0; row < 3; row++) {
      float fr2 = float(row);
      float y = 0.055 + fr2 * 0.105;
      float count = 4.0 - fr2;
      for (int i = 0; i < 4; i++) {
        if (float(i) >= count) break;
        float x = (float(i) - (count - 1.0) * 0.5) * 0.25;
        vec3 c = b - vec3(x, y, 0.0);
        // tapered ingot: narrower on top
        float taper = clamp((c.y + 0.05) / 0.1, 0.0, 1.0);
        vec3 hb = vec3(0.11 - 0.02 * taper, 0.05, 0.3 - 0.03 * taper);
        bars = min(bars, sdRBox(c, hb, 0.01));
      }
    }
    res = opU(res, vec2(bars, 7.0));
  }

  // hinge: pin and two arms, fixed to the wall
  {
    vec3 h = p - HINGE;
    float pin = sdCylZ(h.xzy, 0.07, -0.62, 0.62, 0.02);
    float knuckles = min(sdCylZ((h - vec3(0, 0.38, 0)).xzy, 0.1, -0.12, 0.12, 0.02), sdCylZ((h - vec3(0, -0.38, 0)).xzy, 0.1, -0.12, 0.12, 0.02));
    float plate = sdRBox(p - vec3(1.38, 0.0, 0.09), vec3(0.08, 0.7, 0.08), 0.02);
    res = opU(res, vec2(min(min(pin, knuckles), plate), 8.0));
  }

  // door, swung about the hinge pin
  {
    vec3 q = p - HINGE;
    float c = cos(-uOpen), s = sin(-uOpen);
    q = vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c) + HINGE;
    vec2 d = door(q);
    // arms linking the door to the hinge (move with the door)
    vec3 a = q;
    float arms = min(sdRBox(a - vec3(1.14, 0.38, DZ1 + 0.06), vec3(0.24, 0.07, 0.07), 0.02), sdRBox(a - vec3(1.14, -0.38, DZ1 + 0.06), vec3(0.24, 0.07, 0.07), 0.02));
    d = opU(d, vec2(arms, 8.0));
    res = opU(res, d);
  }
  return res;
}

vec3 calcNormal(vec3 p) {
  const vec2 e = vec2(0.0007, -0.0007);
  return normalize(e.xyy * map(p + e.xyy).x + e.yyx * map(p + e.yyx).x + e.yxy * map(p + e.yxy).x + e.xxx * map(p + e.xxx).x);
}

float softShadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 0.02;
  for (int i = 0; i < 28; i++) {
    float h = map(ro + rd * t).x;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 0.02, 0.25);
    if (res < 0.01 || t > 4.0) break;
  }
  return clamp(res, 0.0, 1.0);
}

float ao(vec3 p, vec3 n) {
  float o = 0.0, s = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.03 * float(i);
    o += (h - map(p + n * h).x) * s;
    s *= 0.6;
  }
  return clamp(1.0 - 3.0 * o, 0.0, 1.0);
}

// studio environment for reflections: a warm soft box upper left, a cool strip right, dark floor
vec3 env(vec3 d, float rough) {
  float w = mix(0.05, 0.6, rough);
  vec3 c = vec3(0.02, 0.02, 0.022) + vec3(0.11, 0.1, 0.09) * smoothstep(-0.3, 1.0, d.y);
  float box = smoothstep(w + 0.35, 0.3 - w * 0.4, length(d - normalize(vec3(-0.5, 0.6, 0.62))));
  c += vec3(1.0, 0.86, 0.66) * box * 2.8;
  float box2 = smoothstep(w + 0.3, 0.2 - w * 0.4, length(d - normalize(vec3(0.35, 0.75, 0.55))));
  c += vec3(0.9, 0.85, 0.8) * box2 * 0.9;
  float strip = smoothstep(0.08 + w, 0.0, abs(d.x - 0.85)) * smoothstep(-0.4, 0.3, d.y) * step(0.0, d.z);
  c += vec3(0.5, 0.58, 0.72) * strip * 0.7;
  // light pouring out of the vault reflects in the door once it's open
  c += vec3(1.0, 0.8, 0.55) * smoothstep(0.5, 1.0, -d.z) * uCam * 0.25;
  return c;
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;

  // camera: resting shot looks past the door so it sits to one side; then it recentres, dollies in, and enters
  float k1 = smoothstep(0.0, 0.35, uCam);
  float k2 = smoothstep(0.3, 1.0, uCam);
  vec3 ro = vec3(-0.55 + uTilt.x * 0.3, 0.22 + uTilt.y * 0.18, 7.0 / uFrame.y);
  ro = mix(ro, vec3(0.0, 0.05, 5.0), k1);
  ro = mix(ro, vec3(0.0, -0.05, -TUNNEL + 2.2), k2);
  vec3 ta = vec3(-uFrame.x * 1.85, 0.08 + uFrame.z * 1.6, 0.0);
  ta = mix(ta, vec3(0.0, -0.02, -1.0), k1);
  ta = mix(ta, vec3(0.0, -0.25, -TUNNEL), k2);
  vec3 ww = normalize(ta - ro), uu = normalize(cross(ww, vec3(0, 1, 0))), vv = cross(uu, ww);
  vec3 rd = normalize(uv.x * uu + uv.y * vv + 1.9 * ww);

  float t = 0.0;
  vec2 h = vec2(0.0);
  bool hit = false;
  for (int i = 0; i < 140; i++) {
    h = map(ro + rd * t);
    if (h.x < 0.0006 * t) { hit = true; break; }
    t += h.x * 0.9;
    if (t > 20.0) break;
  }

  vec3 col = vec3(0.004);
  if (hit) {
    vec3 p = ro + rd * t;
    vec3 n = calcNormal(p);
    float m = h.y;
    vec3 v = -rd;

    // the door's local frame, for brushing and highlights on its face
    vec3 q = p - HINGE;
    float c = cos(-uOpen), s = sin(-uOpen);
    q = vec3(q.x * c + q.z * s, q.y, -q.x * s + q.z * c) + HINGE;
    float rq = length(q.xy);

    vec3 base; float metal; float rough;
    if (m < 1.5) {              // concrete wall
      float nz = fbm(p.xy * 3.0) * 0.6 + fbm(p.xy * 18.0) * 0.4;
      base = vec3(0.16, 0.15, 0.14) * (0.6 + 0.8 * nz);
      metal = 0.0; rough = 0.9;
    } else if (m < 2.5) {       // frame
      base = STEEL * 0.8; metal = 1.0; rough = 0.36 + 0.1 * noise(vec2(atan(p.y, p.x) * 40.0, length(p.xy) * 300.0));
    } else if (m < 3.25) {      // door steel, lathe brushed; the back face is plain mill-finish plate
      float streak = noise(vec2(rq * 420.0, 0.5)) * 0.6 + noise(vec2(rq * 90.0, 3.1)) * 0.4;
      base = STEEL * (0.85 + 0.25 * streak); metal = 1.0; rough = 0.3 + 0.16 * streak;
      if (q.z < DZ0 + 0.02) { base = STEEL * (0.38 + 0.08 * streak); rough = 0.5; }
      else if (rq > DR - 0.012) { base = STEEL * (0.42 + 0.1 * noise(vec2(atan(q.y, q.x) * 3.0, q.z * 260.0))); rough = 0.42; }  // the door's thick edge
    } else if (m < 3.75) {      // hub
      base = STEEL * 0.95; metal = 1.0; rough = 0.18;
    } else if (m < 4.5) {       // brass wheel
      base = BRASS; metal = 1.0; rough = 0.16 + 0.08 * noise(p.xy * 60.0);
    } else if (m < 5.5) {       // chrome bolts and rivets
      base = vec3(0.8, 0.8, 0.82); metal = 1.0; rough = 0.12;
    } else if (m < 6.5) {       // inside the vault: safe-deposit boxes on the walls and back, dark tiles underfoot
      vec2 uv; vec2 cell;
      bool flr = n.y > 0.7;
      if (n.z > 0.7) { uv = p.xy; cell = vec2(0.24, 0.17); }
      else { uv = vec2(atan(p.y, p.x) * RO, p.z); cell = vec2(0.24, 0.3); }
      if (flr) { uv = p.xz; cell = vec2(0.5); }
      if (n.z > 0.7 && p.z > -0.5) { uv = vec2(0.0); cell = vec2(100.0); flr = true; }  // threshold step: plain steel
      vec2 f = abs(fract(uv / cell) - 0.5) * cell;           // distance from the cell centre
      vec2 e = 0.5 * cell - f;                               // distance to the cell edge
      float seam = smoothstep(0.004 + 0.002 * t, 0.012 + 0.004 * t, min(e.x, e.y));
      float key = 1.0 - smoothstep(0.012, 0.016, length(f - vec2(0.0, flr ? 9.0 : 0.0)));
      base = mix(vec3(0.04, 0.038, 0.036), vec3(0.24, 0.235, 0.23), seam);
      metal = 0.75; rough = flr ? 0.3 : 0.55;
      if (!flr && key > 0.5) { base = BRASS; rough = 0.2; }
    } else if (m < 7.5) {       // gold
      base = GOLD; metal = 1.0; rough = 0.1;
    } else {                    // hinge
      base = vec3(0.22, 0.23, 0.25); metal = 1.0; rough = 0.35;
    }

    // lights: warm key from upper left (a spot centred on the door), cool rim, warm light inside the vault
    vec3 L1 = normalize(vec3(-0.55, 0.65, 0.75));
    float spot = mix(0.12, 1.0, smoothstep(3.4, 0.8, length(p.xy - vec2(0.1, 0.25))));
    vec3 L2 = normalize(vec3(0.85, 0.15, 0.45));
    vec3 Lp = vec3(0.0, 0.55, -TUNNEL + 1.6);
    vec3 L3 = normalize(Lp - p);
    float d3 = length(Lp - p);
    float inside = smoothstep(0.4, -0.6, p.z);
    float open = smoothstep(0.0, 0.9, uOpen);

    float sh = inside > 0.98 ? 0.0 : softShadow(p + n * 0.003, L1);
    float occ = ao(p, n);

    vec3 F0 = mix(vec3(0.04), base, metal);
    vec3 diffC = base * (1.0 - metal);

    vec3 lit = vec3(0.0);
    // key
    {
      vec3 hv = normalize(L1 + v);
      float ndl = max(dot(n, L1), 0.0);
      float a2 = pow(max(rough, 0.05), 4.0);
      float ndh = max(dot(n, hv), 0.0);
      float D = a2 / (PI * pow(ndh * ndh * (a2 - 1.0) + 1.0, 2.0));
      vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(hv, v), 0.0), 5.0);
      lit += (diffC / PI + F * D * 0.25) * ndl * sh * vec3(1.0, 0.9, 0.78) * 3.2 * spot * (1.0 - inside);
    }
    // rim
    {
      float ndl = max(dot(n, L2), 0.0);
      lit += (diffC * 0.3 + F0 * 0.25) * ndl * vec3(0.45, 0.55, 0.75) * 0.35;
    }
    // vault light
    {
      float ndl = max(dot(n, L3), 0.0);
      float att = 1.0 / (1.0 + d3 * d3 * 1.6);
      float reach = inside + 0.18 * open * (1.0 - inside);
      lit += (diffC + F0 * 0.5) * ndl * att * vec3(1.0, 0.82, 0.6) * 2.2 * open * reach;
    }
    // reflections of the studio
    vec3 refl = reflect(rd, n);
    vec3 Fv = F0 + (1.0 - F0) * pow(1.0 - max(dot(n, v), 0.0), 5.0);
    lit += env(refl, rough) * Fv * mix(0.35, 1.0, metal) * occ * mix(1.0, 0.55, inside * (1.0 - open));
    lit += diffC * 0.02 * occ;

    col = lit;
    // gold bars glow a little in their own light
    if (m > 6.5 && m < 7.5) col += GOLD * 0.04 * open;
    // distance haze
    col = mix(col, vec3(0.006, 0.005, 0.004), 1.0 - exp(-0.015 * t * t * (1.0 - inside)));
  }

  // light spilling out of the opening, as a glow over the frame
  {
    vec3 oc = -ro;
    float tc = dot(oc, rd);
    vec3 cp = ro + rd * max(tc, 0.0);
    float glow = exp(-pow(length(cp.xy) * 1.1, 2.0)) * smoothstep(0.2, 1.4, uOpen);
    col += GOLD * glow * 0.12 * (1.0 - uCam);
  }
  // at the end, the vault light floods the frame
  

  // vignette and grade
  float vig = smoothstep(1.25, 0.25, length(uv * vec2(0.85, 1.0)));
  col *= mix(0.35, 1.0, vig);
  col = clamp((col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14), 0.0, 1.0);
  col = pow(col, vec3(1.0 / 2.2));
  col += (hash21(gl_FragCoord.xy) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}
`;
