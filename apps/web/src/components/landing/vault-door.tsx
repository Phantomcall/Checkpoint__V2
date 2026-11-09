"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import { VAULT_DOOR_FRAG } from "./vault-door-shader";

/**
 * The hero background: the vault door, drawn by one full-screen fragment shader. `progress` (0..1, owned by the
 * hero's scroll handler) drives the whole sequence: the wheel spins, the bolts pull back, the door swings open on
 * its hinge and the camera moves into the vault. The canvas only redraws when something on screen changed
 * (progress, pointer or size), stops off-screen, and caps its pixel count. Callers get `onUnsupported` when
 * WebGL2 isn't there and show the still poster instead.
 */

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const seg = (p: number, a: number, b: number) => Math.min(1, Math.max(0, (p - a) / (b - a)));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/** The scroll timeline, in one place: progress → what the mechanism is doing. */
export function vaultPose(p: number) {
  return {
    wheel: easeInOut(seg(p, 0.05, 0.36)) * Math.PI * 2.4,
    bolt: easeInOut(seg(p, 0.3, 0.44)),
    open: easeInOut(seg(p, 0.42, 0.8)) * 1.85,
    // ends just short of the gold, so the last frame is a composed shot rather than a wall of bars
    cam: 0.35 * easeOut(seg(p, 0.06, 0.42)) + 0.47 * easeInOut(seg(p, 0.56, 1)),
  };
}

export function VaultDoor({ progress, onUnsupported }: { progress: MutableRefObject<number>; onUnsupported?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, powerPreference: "high-performance" });
    if (!gl) return void onUnsupported?.();

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
      return s;
    };
    const prog = gl.createProgram()!;
    try {
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, VAULT_DOOR_FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
    } catch (e) {
      console.error(e);
      return void onUnsupported?.();
    }
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = Object.fromEntries(["uRes", "uWheel", "uBolt", "uOpen", "uCam", "uFrame", "uTilt"].map((n) => [n, gl.getUniformLocation(prog, n)]));

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = { x: 0.55, zoom: 1, y: 0 };
    const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

    function resize() {
      const r = canvas!.getBoundingClientRect();
      // Ray marching is per pixel: render under the screen's resolution and let the browser scale it up.
      const budget = r.width < 768 ? 420_000 : 900_000;
      let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const px = r.width * r.height * dpr * dpr;
      if (px > budget) dpr *= Math.sqrt(budget / px);
      canvas!.width = Math.max(1, Math.round(r.width * dpr));
      canvas!.height = Math.max(1, Math.round(r.height * dpr));
      gl!.viewport(0, 0, canvas!.width, canvas!.height);
      // Wide screens: the door sits right of the copy. Narrow ones: centred, pulled back so it fits.
      const aspect = r.width / Math.max(1, r.height);
      const wide = r.width >= 1024 && aspect > 1.25;
      // Narrow screens put the door in the top half and leave the bottom half for the copy.
      frame.x = wide ? 0.55 : 0;
      frame.zoom = wide ? 1 : Math.min(1, Math.max(0.5, aspect * 1.15));
      frame.y = wide ? 0 : aspect < 0.55 ? -0.58 : aspect < 0.8 ? -0.42 : -0.2;
      dirty = true;
    }

    let dirty = true;
    let last = { p: -1, tx: 0, ty: 0 };
    function draw() {
      const p = reduced ? 0 : progress.current;
      const pose = vaultPose(p);
      gl!.uniform2f(U.uRes!, canvas!.width, canvas!.height);
      gl!.uniform1f(U.uWheel!, pose.wheel);
      gl!.uniform1f(U.uBolt!, pose.bolt);
      gl!.uniform1f(U.uOpen!, pose.open);
      gl!.uniform1f(U.uCam!, pose.cam);
      // The framing eases back to centre as the camera recentres on the door.
      const c = 1 - seg(p, 0.06, 0.42);
      gl!.uniform3f(U.uFrame!, frame.x, frame.zoom + (1 - frame.zoom) * (1 - c), frame.y * c);
      // Parallax fades out once the door starts opening, so the camera move stays clean.
      const k = 1 - seg(p, 0.05, 0.3);
      gl!.uniform2f(U.uTilt!, tilt.x * k, tilt.y * k);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
      last = { p, tx: tilt.x, ty: tilt.y };
      dirty = false;
    }

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (reduced) {
      draw();
      const redraw = new ResizeObserver(() => draw());
      redraw.observe(canvas);
      return () => {
        ro.disconnect();
        redraw.disconnect();
      };
    }

    let raf = 0;
    let visible = true;
    let prev = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - prev) / 1000);
      prev = now;
      tilt.x += (tilt.tx - tilt.x) * Math.min(1, dt * 2.5);
      tilt.y += (tilt.ty - tilt.y) * Math.min(1, dt * 2.5);
      const moved = Math.abs(progress.current - last.p) > 1e-4 || Math.abs(tilt.x - last.tx) > 1e-3 || Math.abs(tilt.y - last.ty) > 1e-3;
      if (dirty || moved) draw();
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (!raf && visible && !document.hidden) {
        prev = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = !!e?.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    const onMove = (e: PointerEvent) => {
      tilt.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      tilt.ty = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    const onLost = (e: Event) => {
      e.preventDefault();
      stop();
      onUnsupported?.();
    };
    canvas.addEventListener("webglcontextlost", onLost);
    start();

    return () => {
      stop();
      ro.disconnect();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("webglcontextlost", onLost);
    };
    // progress is a ref; the effect wires it once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="absolute inset-0 block size-full" aria-hidden />;
}
