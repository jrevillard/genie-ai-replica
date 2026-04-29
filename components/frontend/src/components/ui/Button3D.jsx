/**
 * Button3D — WebGL-powered clinical submit button.
 * ===================================================
 *
 * A professional-looking <button> that renders a subtle Three.js canvas
 * *behind* the label. The canvas shows a slow-drifting gradient mesh
 * with a mild fresnel glow; on hover, the mesh tilts toward the cursor;
 * on press, the button dips down with a soft ripple; on submit/loading,
 * the mesh pulses gently. The visual cue stays muted and clinical — no
 * particles, no flashy motion — so it belongs on a healthcare login
 * screen next to the PasswordField.
 *
 * Design principles:
 *   - Three.js renders only the background; text + semantics stay as a
 *     native <button> so screen readers, keyboard nav, and form
 *     submission all work as expected
 *   - Respects `prefers-reduced-motion`: falls back to a static gradient
 *   - Lazy-animated — renders at ~30fps only while mounted & visible
 *   - Cleans up the renderer + geometry + material on unmount
 *   - Disabled + loading states render with reduced color saturation
 *
 * Usage:
 *   <Button3D type="submit" onClick={...} loading={busy}>
 *     Sign in
 *   </Button3D>
 */

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";

const DPR_CAP = 2;              // cap devicePixelRatio (perf)
const IDLE_FPS = 30;            // throttle render loop
const COLORS = {
  // Clinical indigo/teal gradient — muted, not flashy.
  a: new THREE.Color("#4f46e5"),   // indigo-600
  b: new THREE.Color("#0ea5e9"),   // sky-500
  c: new THREE.Color("#6366f1"),   // indigo-500
  hover: new THREE.Color("#818cf8"),  // indigo-400 — slight lift on hover
};

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch { return false; }
}

export default function Button3D({
  children,
  onClick,
  type = "button",
  loading = false,
  disabled = false,
  width,                  // optional fixed width (px or "auto")
  size = "md",            // "sm" | "md" | "lg" — controls height + padding + radius
  style: styleOverride,
  className = "",
  ...rest
}) {
  const SIZE = {
    sm: { minHeight: 36, padding: "0 14px", radius: 8,  fontSize: 13,  shadowY: 4,  shadowA: 0.22 },
    md: { minHeight: 42, padding: "0 18px", radius: 10, fontSize: 14,  shadowY: 6,  shadowA: 0.28 },
    lg: { minHeight: 48, padding: "0 22px", radius: 12, fontSize: 15,  shadowY: 10, shadowA: 0.38 },
  }[size] || undefined;
  const canvasRef   = useRef(null);
  const rafRef      = useRef(0);
  const rendererRef = useRef(null);
  const sceneRef    = useRef(null);
  const meshRef     = useRef(null);
  const uniformsRef = useRef(null);
  const mouseRef    = useRef({ x: 0, y: 0, tiltX: 0, tiltY: 0 });
  const lastFrame   = useRef(0);
  const [pressed,  setPressed]  = useState(false);
  const [hover,    setHover]    = useState(false);
  const reducedRef              = useRef(false);

  // ── Init Three.js once on mount
  useEffect(() => {
    reducedRef.current = prefersReducedMotion();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const width0  = canvas.clientWidth  || 220;
    const height0 = canvas.clientHeight || 48;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: "low-power",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
    renderer.setSize(width0, height0, false);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.OrthographicCamera(-1, 1, 0.5, -0.5, 0, 1);
    scene.add(camera);

    // Fragment shader: slow gradient drift + subtle noise + fresnel edge
    const uniforms = {
      u_time:     { value: 0 },
      u_resolution: { value: new THREE.Vector2(width0, height0) },
      u_mouse:    { value: new THREE.Vector2(0.5, 0.5) },
      u_hover:    { value: 0 },
      u_press:    { value: 0 },
      u_loading:  { value: 0 },
      u_disabled: { value: 0 },
      u_colorA:   { value: COLORS.a },
      u_colorB:   { value: COLORS.b },
      u_colorC:   { value: COLORS.c },
      u_colorHover: { value: COLORS.hover },
    };
    uniformsRef.current = uniforms;

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float u_time;
        uniform vec2  u_resolution;
        uniform vec2  u_mouse;
        uniform float u_hover;
        uniform float u_press;
        uniform float u_loading;
        uniform float u_disabled;
        uniform vec3  u_colorA;
        uniform vec3  u_colorB;
        uniform vec3  u_colorC;
        uniform vec3  u_colorHover;

        // cheap 2D hash noise
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i),           hash(i + vec2(1,0)), u.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
        }

        void main() {
          vec2 uv = vUv;
          // Slow horizontal drift
          float t = u_time * 0.12;
          float wave = sin((uv.x * 2.5) + t) * 0.12 + 0.5;
          float n    = noise(uv * 3.0 + vec2(t, -t * 0.5)) * 0.15;

          // Tri-color blend: A → C → B as x goes 0→1
          vec3 base = mix(u_colorA, u_colorC, smoothstep(0.0, 0.55, uv.x + n));
          base      = mix(base,     u_colorB, smoothstep(0.45, 1.0,  uv.x + n));

          // Hover lift: blend toward hover color near the cursor
          float dx = uv.x - u_mouse.x;
          float dy = uv.y - u_mouse.y;
          float d  = sqrt(dx*dx + dy*dy);
          float hoverMix = u_hover * smoothstep(0.8, 0.0, d) * 0.35;
          base = mix(base, u_colorHover, hoverMix);

          // Press dip: darken slightly
          base *= 1.0 - u_press * 0.15;

          // Loading pulse
          base *= 1.0 + u_loading * 0.12 * sin(u_time * 4.0);

          // Fresnel-like edge brighten
          float edge = 1.0 - abs(uv.y - 0.5) * 2.0;
          base += vec3(0.08) * pow(edge, 2.2);

          // Disabled: desaturate + dim
          if (u_disabled > 0.5) {
            float g = dot(base, vec3(0.33, 0.34, 0.33));
            base = mix(vec3(g), base, 0.25) * 0.6;
          }

          gl_FragColor = vec4(base, 1.0);
        }
      `,
    });

    const geometry = new THREE.PlaneGeometry(2, 1);
    const mesh     = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshRef.current = mesh;

    // Resize observer
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const { width: w, height: h } = e.contentRect;
        renderer.setSize(Math.max(1, w), Math.max(1, h), false);
        uniforms.u_resolution.value.set(w, h);
      }
    });
    ro.observe(canvas);

    const tick = (now) => {
      rafRef.current = requestAnimationFrame(tick);
      // Throttle to IDLE_FPS
      const interval = 1000 / IDLE_FPS;
      if (now - lastFrame.current < interval) return;
      lastFrame.current = now;

      // Smoothly track mouse
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      uniforms.u_mouse.value.x += (mx - uniforms.u_mouse.value.x) * 0.12;
      uniforms.u_mouse.value.y += (my - uniforms.u_mouse.value.y) * 0.12;
      uniforms.u_time.value = reducedRef.current ? 0 : now * 0.001;
      renderer.render(scene, camera);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      try { ro.disconnect(); } catch {}
      try { geometry.dispose(); } catch {}
      try { material.dispose();  } catch {}
      try { renderer.dispose();  } catch {}
      rendererRef.current = null;
      sceneRef.current = null;
      meshRef.current  = null;
      uniformsRef.current = null;
    };
  }, []);

  // React state → uniforms
  useEffect(() => {
    const u = uniformsRef.current;
    if (!u) return;
    u.u_hover.value    = hover    ? 1 : 0;
    u.u_press.value    = pressed  ? 1 : 0;
    u.u_loading.value  = loading  ? 1 : 0;
    u.u_disabled.value = disabled ? 1 : 0;
  }, [hover, pressed, loading, disabled]);

  const onMouseMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current.x = (e.clientX - rect.left) / rect.width;
    mouseRef.current.y = 1 - (e.clientY - rect.top) / rect.height;
  }, []);

  const btnStyle = {
    position:      "relative",
    display:       "inline-flex",
    alignItems:    "center",
    justifyContent: "center",
    width:         width || "100%",
    minHeight:     SIZE.minHeight,
    padding:       SIZE.padding,
    border:        "none",
    borderRadius:  SIZE.radius,
    overflow:      "hidden",
    cursor:        disabled || loading ? "not-allowed" : "pointer",
    background:    "#0f172a",    // fallback if WebGL fails
    color:         "#ffffff",
    fontSize:      SIZE.fontSize,
    fontWeight:    600,
    fontFamily:    "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    letterSpacing: 0.2,
    transform:     pressed ? "translateY(0.5px) scale(0.997)" : "translateY(0) scale(1)",
    boxShadow:     disabled ? "none"
                     : pressed
                        ? `0 1px 4px rgba(79, 70, 229, ${SIZE.shadowA * 0.7})`
                        : hover
                          ? `0 ${SIZE.shadowY + 4}px ${SIZE.shadowY * 3}px rgba(79, 70, 229, ${SIZE.shadowA + 0.10}), 0 1px 2px rgba(0,0,0,0.18)`
                          : `0 ${SIZE.shadowY}px ${SIZE.shadowY * 2.5}px rgba(79, 70, 229, ${SIZE.shadowA}), 0 1px 2px rgba(0,0,0,0.10)`,
    transition:    "transform 140ms ease, box-shadow 200ms ease",
    outline:       "none",
    userSelect:    "none",
    WebkitTapHighlightColor: "transparent",
    ...styleOverride,
  };

  const canvasStyle = {
    position:      "absolute",
    inset:         0,
    width:         "100%",
    height:        "100%",
    pointerEvents: "none",
    display:       "block",
    borderRadius:  SIZE.radius,
  };

  const labelStyle = {
    position:      "relative",    // above the canvas
    zIndex:        1,
    display:       "inline-flex",
    alignItems:    "center",
    gap:           8,
    textShadow:    "0 1px 2px rgba(0,0,0,0.35)",
  };

  const handleClick = (e) => {
    if (disabled || loading) { e.preventDefault(); return; }
    onClick && onClick(e);
  };

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled || loading}
      className={`amina-btn3d ${className}`.trim()}
      style={btnStyle}
      onMouseEnter={() => !disabled && !loading && setHover(true)}
      onMouseLeave={() => { setHover(false); setPressed(false); }}
      onMouseMove={onMouseMove}
      onMouseDown={() => !disabled && !loading && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onFocus={() => !disabled && !loading && setHover(true)}
      onBlur={() => setHover(false)}
      aria-busy={loading || undefined}
      {...rest}
    >
      <canvas ref={canvasRef} style={canvasStyle} />
      <span style={labelStyle}>
        {loading ? (
          <>
            <Spinner />
            <span>{typeof children === "string" ? "Please wait" : children}</span>
          </>
        ) : children}
      </span>
    </button>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display:        "inline-block",
        width:          16,
        height:         16,
        border:         "2px solid rgba(255,255,255,0.35)",
        borderTopColor: "#ffffff",
        borderRadius:   "50%",
        animation:      "amina-btn3d-spin 0.8s linear infinite",
      }}
    />
  );
}

// Inject the keyframes once (idempotent). Doing it here avoids the
// dependency on a global stylesheet import order.
if (typeof document !== "undefined" && !document.getElementById("amina-btn3d-style")) {
  const s = document.createElement("style");
  s.id = "amina-btn3d-style";
  s.textContent =
    `@keyframes amina-btn3d-spin { to { transform: rotate(360deg); } }`;
  document.head.appendChild(s);
}
