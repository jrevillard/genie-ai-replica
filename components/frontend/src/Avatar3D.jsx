import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const URL_GLB = "/avatar.glb";

const RPM_VISEMES = [
  "viseme_PP", "viseme_FF", "viseme_TH", "viseme_DD", "viseme_kk",
  "viseme_CH", "viseme_SS", "viseme_nn", "viseme_RR", "viseme_aa",
  "viseme_E", "viseme_I", "viseme_O", "viseme_U", "viseme_sil",
];

function avg(data, start, end) {
  const s = Math.max(0, Math.floor(start));
  const e = Math.max(s, Math.floor(end));
  let total = 0;
  for (let i = s; i < e; i++) total += data[i];
  return e - s > 0 ? total / (e - s) : 0;
}

function clamp(v, mn, mx) {
  return Math.min(mx, Math.max(mn, v));
}

export default function Avatar3D({
  isSpeaking,
  audioAnalyser,
  emotion = "smile",
  size = 170,
}) {
  const mountRef = useRef(null);
  const speakingRef = useRef(isSpeaking);
  const analyserRef = useRef(audioAnalyser);
  const emotionRef = useRef(emotion);
  const rafRef = useRef(0);
  const reloadTimerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => { speakingRef.current = isSpeaking; }, [isSpeaking]);
  useEffect(() => { analyserRef.current = audioAnalyser; }, [audioAnalyser]);
  useEffect(() => { emotionRef.current = emotion; }, [emotion]);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    let disposed = false;
    let modelLoaded = false;
    let renderer = null;
    let avatarRoot = null;
    let scene = null;
    let camera = null;
    let hasMorphs = false;

    const morphMeshes = [];
    const smoothVisemes = new Array(RPM_VISEMES.length).fill(0);
    let smoothMH = {};

    let headBone = null;
    let neckBone = null;
    let spineBone = null;
    let jawBone = null;
    let blinkTimer = 0;
    let blinkAnim = 0;
    let idlePhase = 0;
    let breathPhase = 0;
    let microMovT = 0;

    function scheduleReload() {
      if (disposed) return;
      clearTimeout(reloadTimerRef.current);
      reloadTimerRef.current = setTimeout(() => {
        setReady(false);
        setReloadKey((k) => k + 1);
      }, 200);
    }

    try {
      scene = new THREE.Scene();
      scene.background = null;

      camera = new THREE.PerspectiveCamera(18, 1, 0.01, 100);
      camera.position.set(0, 1.58, 2.15);
      camera.lookAt(0, 1.58, 0);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setSize(size, size);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.6;

      const canvas = renderer.domElement;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.style.display = "block";
      canvas.style.borderRadius = "50%";

      canvas.addEventListener("webglcontextlost", (e) => {
        e.preventDefault();
        scheduleReload();
      }, false);

      el.innerHTML = "";
      el.appendChild(canvas);

      // ── Lighting (bright, warm for dark skin) ──
      scene.add(new THREE.AmbientLight(0xfff5ee, 1.4));

      const keyLight = new THREE.DirectionalLight(0xfff0e8, 2.2);
      keyLight.position.set(1.5, 2.5, 3.5);
      scene.add(keyLight);

      const fillLight = new THREE.DirectionalLight(0xb0c4ff, 1.0);
      fillLight.position.set(-2, 1.5, 2);
      scene.add(fillLight);

      const rimLight = new THREE.DirectionalLight(0xd4a0ff, 0.6);
      rimLight.position.set(0, 2, -2.5);
      scene.add(rimLight);

      const bottomLight = new THREE.DirectionalLight(0xffe0cc, 0.5);
      bottomLight.position.set(0, -1, 2);
      scene.add(bottomLight);

      const frontLight = new THREE.DirectionalLight(0xffeedd, 0.8);
      frontLight.position.set(0, 1.6, 3);
      scene.add(frontLight);

      const pointLight = new THREE.PointLight(0xffd4a0, 0.5, 10);
      pointLight.position.set(0.5, 1.75, 1.5);
      scene.add(pointLight);

      const avatarGroup = new THREE.Group();
      scene.add(avatarGroup);

      // ── Setup avatar ──
      function setupAvatar(root) {
        root.updateMatrixWorld(true);

        root.traverse((obj) => {
          if (!obj.isBone) return;
          const n = obj.name.toLowerCase().replace("mixamorig:", "").replace("mixamorig", "");
          if (n === "head") headBone = obj;
          else if (n.includes("neck") && !neckBone) neckBone = obj;
          else if ((n === "spine2" || n === "spine1") && !spineBone) spineBone = obj;
          else if (n.includes("jaw")) jawBone = obj;
        });

        root.traverse((obj) => {
          if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
            const count = Object.keys(obj.morphTargetDictionary).length;
            if (count > 0) {
              morphMeshes.push(obj);
              if (obj.morphTargetDictionary["jawOpen"] !== undefined) hasMorphs = true;
              Object.keys(obj.morphTargetDictionary).forEach((k) => {
                if (smoothMH[k] === undefined) smoothMH[k] = 0;
              });
              console.log("Morph mesh:", obj.name, "| Targets:", count);
            }
          }
        });

        // Log materials for debugging
        root.traverse((obj) => {
          if (obj.isMesh) {
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
              if (m) console.log("Material:", m.name, "| hasMap:", !!m.map, "| mesh:", obj.name);
            });
          }
        });

        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());

        let targetY = center.y;
        if (headBone) {
          const hp = new THREE.Vector3();
          headBone.getWorldPosition(hp);
          targetY = hp.y;
        }

        camera.position.set(0, targetY, 1.0);
        camera.lookAt(0, targetY - 0.02, 0);
        camera.fov = 24;
        camera.updateProjectionMatrix();

        avatarGroup.position.x = -center.x;
        avatarGroup.position.z = -center.z;

        console.log("Avatar setup:",
          "Head:", !!headBone, "| Neck:", !!neckBone,
          "| Jaw:", !!jawBone, "| MorphMeshes:", morphMeshes.length,
          "| HasMorphTargets:", hasMorphs);
      }

      // ── Load ──
      const timeoutId = setTimeout(() => {
        if (!modelLoaded && !disposed) scheduleReload();
      }, 20000);

      const loader = new GLTFLoader();
      loader.setCrossOrigin("anonymous");
      loader.load(
        URL_GLB,
        (gltf) => {
          if (disposed) return;
          avatarRoot = gltf.scene;
          avatarRoot.traverse((obj) => {
            if (obj.isMesh) {
              obj.frustumCulled = false;
            }
          });
          avatarGroup.add(avatarRoot);
          setupAvatar(avatarRoot);
          modelLoaded = true;
          clearTimeout(timeoutId);
          setReady(true);
        },
        undefined,
        (err) => {
          console.error("GLB load error:", err);
          clearTimeout(timeoutId);
          if (!disposed) scheduleReload();
        }
      );

      // ── Animation loop ──
      const clock = new THREE.Clock();

      const animate = () => {
        if (disposed || !renderer || !scene || !camera) return;
        rafRef.current = requestAnimationFrame(animate);

        const dt = clock.getDelta();
        const t = clock.elapsedTime;
        const speaking = speakingRef.current;
        const analyser = analyserRef.current;
        const em = emotionRef.current;

        idlePhase += dt;
        breathPhase += dt * (speaking ? 2.5 : 1.2);
        microMovT += dt;

        // ── Bone animations ──
        if (headBone) {
          const amp = speaking ? 0.035 : 0.012;
          headBone.rotation.x = Math.sin(idlePhase * 0.5) * amp + Math.sin(microMovT * 2.3) * 0.003;
          headBone.rotation.y = Math.sin(idlePhase * 0.7) * amp * 0.6 + Math.sin(microMovT * 1.8) * 0.003;
          headBone.rotation.z = Math.sin(idlePhase * 0.35) * amp * 0.3;
        }
        if (neckBone) {
          const na = speaking ? 0.015 : 0.006;
          neckBone.rotation.x = Math.sin(idlePhase * 0.5) * na * 0.5;
          neckBone.rotation.y = Math.sin(idlePhase * 0.7) * na * 0.3;
        }
        if (spineBone) {
          spineBone.rotation.x = Math.sin(breathPhase) * 0.008;
        }

        // ── Blinking ──
        blinkTimer += dt;
        if (blinkAnim === 0 && blinkTimer > 2.8 + Math.random() * 2.5) {
          blinkAnim = 0.001;
          blinkTimer = 0;
        }
        if (blinkAnim > 0) {
          blinkAnim += dt * 8;
          if (blinkAnim > 2) blinkAnim = 0;
        }
        const blink = blinkAnim > 0 ? Math.sin(blinkAnim * Math.PI) : 0;

        // ── Audio ──
        let level = 0;
        let freqData = null;
        if (analyser && speaking) {
          freqData = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(freqData);
          let sum = 0;
          for (let i = 0; i < freqData.length; i++) sum += freqData[i];
          level = sum / freqData.length / 255;
        }

        // ── MetaHuman morph targets ──
        if (hasMorphs) {
          let tJaw = 0, tFunnel = 0, tPucker = 0, tClose = 0;
          let tSmileL = 0, tSmileR = 0;
          let tLowerL = 0, tLowerR = 0, tUpperL = 0, tUpperR = 0;
          let tStretchL = 0, tStretchR = 0;

          if (speaking) {
            if (freqData && level > 0.02) {
              const n = freqData.length;
              const intensity = Math.min(level * 3.2, 1);
              const lo = avg(freqData, 0, n * 0.12) / 255;
              const ml = avg(freqData, n * 0.12, n * 0.3) / 255;
              const md = avg(freqData, n * 0.3, n * 0.5) / 255;
              const hi = avg(freqData, n * 0.6, n * 0.85) / 255;
              tJaw = clamp(lo * intensity * 0.75 + ml * intensity * 0.25, 0, 0.7);
              tFunnel = clamp(md * intensity * 0.45, 0, 0.5);
              tPucker = clamp(hi * intensity * 0.35, 0, 0.4);
              tLowerL = clamp(lo * intensity * 0.4, 0, 0.5);
              tLowerR = clamp(lo * intensity * 0.4, 0, 0.5);
              tUpperL = clamp(ml * intensity * 0.2, 0, 0.3);
              tUpperR = clamp(ml * intensity * 0.2, 0, 0.3);
              tStretchL = clamp(md * intensity * 0.15, 0, 0.3);
              tStretchR = clamp(md * intensity * 0.15, 0, 0.3);
              if (hi > 0.3 && lo < 0.15) tClose = 0.2;
            } else {
              tJaw = 0.08 + Math.max(0, Math.sin(t * 9)) * 0.18;
              tFunnel = 0.03 + Math.max(0, Math.sin(t * 6.5)) * 0.08;
            }
            tSmileL = 0.08;
            tSmileR = 0.08;
          }

          if (em === "smile" && !speaking) { tSmileL = 0.35; tSmileR = 0.35; }

          const spd = speaking ? 14 : 6;
          const s = (key, target) => {
            smoothMH[key] = (smoothMH[key] || 0) + (target - (smoothMH[key] || 0)) * dt * spd;
            return clamp(smoothMH[key], 0, 1);
          };

          for (const mesh of morphMeshes) {
            const d = mesh.morphTargetDictionary;
            const inf = mesh.morphTargetInfluences;
            if (!d || !inf) continue;
            if (d["jawOpen"] !== undefined) inf[d["jawOpen"]] = s("jawOpen", tJaw);
            if (d["mouthClose"] !== undefined) inf[d["mouthClose"]] = s("mouthClose", tClose);
            if (d["mouthFunnel"] !== undefined) inf[d["mouthFunnel"]] = s("mouthFunnel", tFunnel);
            if (d["mouthPucker"] !== undefined) inf[d["mouthPucker"]] = s("mouthPucker", tPucker);
            if (d["mouthLowerDownLeft"] !== undefined) inf[d["mouthLowerDownLeft"]] = s("mouthLowerDownLeft", tLowerL);
            if (d["mouthLowerDownRight"] !== undefined) inf[d["mouthLowerDownRight"]] = s("mouthLowerDownRight", tLowerR);
            if (d["mouthUpperUpLeft"] !== undefined) inf[d["mouthUpperUpLeft"]] = s("mouthUpperUpLeft", tUpperL);
            if (d["mouthUpperUpRight"] !== undefined) inf[d["mouthUpperUpRight"]] = s("mouthUpperUpRight", tUpperR);
            if (d["mouthStretchLeft"] !== undefined) inf[d["mouthStretchLeft"]] = s("mouthStretchLeft", tStretchL);
            if (d["mouthStretchRight"] !== undefined) inf[d["mouthStretchRight"]] = s("mouthStretchRight", tStretchR);
            if (d["mouthSmileLeft"] !== undefined) inf[d["mouthSmileLeft"]] = s("mouthSmileLeft", tSmileL);
            if (d["mouthSmileRight"] !== undefined) inf[d["mouthSmileRight"]] = s("mouthSmileRight", tSmileR);
            if (d["eyeBlinkLeft"] !== undefined) inf[d["eyeBlinkLeft"]] = blink;
            if (d["eyeBlinkRight"] !== undefined) inf[d["eyeBlinkRight"]] = blink;
            const browUp = em === "think" ? 0.35 : (speaking ? 0.05 + Math.sin(t * 2) * 0.04 : 0);
            if (d["browInnerUp"] !== undefined) inf[d["browInnerUp"]] = s("browInnerUp", browUp);
            if (em === "smile" && !speaking) {
              if (d["eyeSquintLeft"] !== undefined) inf[d["eyeSquintLeft"]] = s("eyeSquintLeft", 0.15);
              if (d["eyeSquintRight"] !== undefined) inf[d["eyeSquintRight"]] = s("eyeSquintRight", 0.15);
              if (d["noseSneerLeft"] !== undefined) inf[d["noseSneerLeft"]] = s("noseSneerLeft", 0.08);
              if (d["noseSneerRight"] !== undefined) inf[d["noseSneerRight"]] = s("noseSneerRight", 0.08);
            } else {
              if (d["eyeSquintLeft"] !== undefined) inf[d["eyeSquintLeft"]] = s("eyeSquintLeft", 0);
              if (d["eyeSquintRight"] !== undefined) inf[d["eyeSquintRight"]] = s("eyeSquintRight", 0);
            }
          }
        }
        // ── RPM viseme fallback ──
        else if (morphMeshes.length > 0) {
          const targets = new Array(RPM_VISEMES.length).fill(0);
          if (speaking) {
            if (freqData && level > 0.02) {
              const n = freqData.length;
              const intensity = Math.min(level * 3, 1);
              const lo = avg(freqData, 0, n * 0.15) / 255;
              const ml = avg(freqData, n * 0.15, n * 0.3) / 255;
              const md = avg(freqData, n * 0.3, n * 0.5) / 255;
              const mh = avg(freqData, n * 0.5, n * 0.7) / 255;
              const hi = avg(freqData, n * 0.7, n) / 255;
              targets[9] = lo * intensity * 1.2;
              targets[12] = ml * intensity * 0.8;
              targets[13] = ml * intensity * 0.6;
              targets[10] = md * intensity * 0.7;
              targets[11] = md * intensity * 0.5;
              targets[3] = md * intensity * 0.4;
              targets[6] = mh * intensity * 0.6;
              targets[5] = mh * intensity * 0.5;
              targets[1] = hi * intensity * 0.5;
              targets[0] = lo * intensity * 0.3;
              targets[8] = ml * intensity * 0.4;
            } else {
              targets[9] = 0.16 + Math.max(0, Math.sin(t * 8.5)) * 0.14;
              targets[12] = 0.06 + Math.max(0, Math.sin(t * 6.5)) * 0.08;
            }
          }
          const smooth = speaking ? 12 : 6;
          for (let i = 0; i < targets.length; i++) {
            smoothVisemes[i] += (targets[i] - smoothVisemes[i]) * dt * smooth;
          }
          for (const mesh of morphMeshes) {
            const d = mesh.morphTargetDictionary;
            const inf = mesh.morphTargetInfluences;
            for (let i = 0; i < RPM_VISEMES.length; i++) {
              if (d[RPM_VISEMES[i]] !== undefined) inf[d[RPM_VISEMES[i]]] = clamp(smoothVisemes[i], 0, 1);
            }
            if (d.eyeBlinkLeft !== undefined) inf[d.eyeBlinkLeft] = blink;
            if (d.eyeBlinkRight !== undefined) inf[d.eyeBlinkRight] = blink;
            if (d.mouthSmileLeft !== undefined) inf[d.mouthSmileLeft] = em === "smile" ? 0.35 : 0;
            if (d.mouthSmileRight !== undefined) inf[d.mouthSmileRight] = em === "smile" ? 0.35 : 0;
          }
        }

        // Jaw bone
        if (jawBone && speaking) {
          jawBone.rotation.x = Math.min(level * 0.4, 0.2);
        } else if (jawBone) {
          jawBone.rotation.x *= 0.9;
        }

        try { renderer.render(scene, camera); }
        catch { scheduleReload(); }
      };

      animate();

      return () => {
        disposed = true;
        clearTimeout(timeoutId);
        clearTimeout(reloadTimerRef.current);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
        if (avatarRoot) {
          avatarRoot.traverse((obj) => {
            if (obj.isMesh) {
              obj.geometry?.dispose?.();
              const m = obj.material;
              if (Array.isArray(m)) m.forEach((x) => x?.dispose?.());
              else m?.dispose?.();
            }
          });
        }
        if (renderer) {
          renderer.dispose();
          const c = renderer.domElement;
          if (c && el.contains(c)) el.removeChild(c);
        }
      };
    } catch {
      scheduleReload();
      return () => {
        disposed = true;
        clearTimeout(reloadTimerRef.current);
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }
  }, [size, reloadKey]);

  const sz = size;

  return (
    <div style={{ width: sz, height: sz, borderRadius: "50%", overflow: "visible", position: "relative", flexShrink: 0 }}>
      <div style={{
        position: "absolute", inset: -28, borderRadius: "50%",
        background: `linear-gradient(180deg, rgba(58,76,255,${isSpeaking ? 0.34 : 0.26}) 0%, rgba(108,43,255,${isSpeaking ? 0.30 : 0.23}) 34%, rgba(162,20,255,${isSpeaking ? 0.28 : 0.21}) 68%, rgba(214,0,255,${isSpeaking ? 0.26 : 0.19}) 100%)`,
        filter: isSpeaking ? "blur(20px)" : "blur(18px)",
        zIndex: 0, pointerEvents: "none",
        opacity: isSpeaking ? 0.95 : 0.8,
        transform: isSpeaking ? "scale(1.08)" : "scale(1)",
        transition: "opacity 0.35s ease, transform 0.35s ease",
      }} />
      <div style={{
        position: "absolute", inset: -12, borderRadius: "50%",
        background: "linear-gradient(180deg, rgba(67,86,255,0.18) 0%, rgba(124,58,237,0.14) 48%, rgba(217,70,239,0.12) 100%)",
        filter: "blur(10px)", zIndex: 1, pointerEvents: "none",
        opacity: isSpeaking ? 1 : 0.75, transition: "opacity 0.35s ease",
      }} />
      <div style={{
        position: "absolute", inset: 0, borderRadius: "50%",
        background: "linear-gradient(180deg, #4356ff 0%, #6c2bff 35%, #a214ff 70%, #d600ff 100%)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 2, opacity: ready ? 0 : 1, transition: "opacity 0.4s ease", pointerEvents: "none",
      }}>
        <span style={{ color: "#fff", fontWeight: 800, fontSize: sz * 0.32, fontFamily: "Outfit,sans-serif", textShadow: "0 2px 10px rgba(0,0,0,0.2)" }}>A</span>
      </div>
      <div ref={mountRef} style={{
        position: "absolute", inset: 0, borderRadius: "50%", overflow: "hidden",
        zIndex: 10, opacity: ready ? 1 : 0, transition: "opacity 0.4s ease",
      }} />
      {isSpeaking && (
        <>
          <div style={{ position: "absolute", inset: -10, borderRadius: "50%", border: "2px solid rgba(129,140,248,0.3)", animation: "avRing 2s ease-out infinite", zIndex: 1 }} />
          <div style={{ position: "absolute", inset: -10, borderRadius: "50%", border: "2px solid rgba(168,85,247,0.22)", animation: "avRing 2s ease-out 0.6s infinite", zIndex: 1 }} />
          <div style={{ position: "absolute", inset: -10, borderRadius: "50%", border: "2px solid rgba(217,70,239,0.16)", animation: "avRing 2s ease-out 1.2s infinite", zIndex: 1 }} />
        </>
      )}
      {isSpeaking && (
        <div style={{ position: "absolute", inset: 0, borderRadius: "50%", animation: "avGlow 1.5s ease-in-out infinite", zIndex: 4, pointerEvents: "none" }} />
      )}
      <style>{`
        @keyframes avRing { 0% { transform: scale(1); opacity: 0.6; } 100% { transform: scale(1.5); opacity: 0; } }
        @keyframes avGlow { 0%, 100% { box-shadow: inset 0 0 20px rgba(255,255,255,0.04), 0 0 15px rgba(99,102,241,0.12); } 50% { box-shadow: inset 0 0 30px rgba(255,255,255,0.07), 0 0 35px rgba(162,20,255,0.22); } }
      `}</style>
    </div>
  );
}
