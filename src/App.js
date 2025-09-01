import React, { Suspense, useRef, useState, useEffect, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import {
  Sky,
  useGLTF,
  Html,
  useProgress,
  Environment,
  PerspectiveCamera,
} from "@react-three/drei";
import * as THREE from "three";
import { Water } from "three-stdlib";

// -------------------- Simulation Configuration --------------------
const SIM_CONFIG = {
  START_Z: -1200,
  START_Y: 90,
  TOUCHDOWN_Z: 210,
  RUNWAY_END_Z: 640,
  LANDING_ALTITUDE: 0.9,
  FLARE_PULL_UP_ROTATION: 0.08,
  APPROACH_ROTATION: -0.06,
  CRASH_GROUND_Y: 0.45,
  BASE_SPEED: 40,
  THROTTLE_FAILURE_SPEED: 18,
  CAMERA_FOLLOW_DISTANCE_Z: -82,
  CAMERA_FOLLOW_HEIGHT_Y: 28,
};


// -------------------- Loading Screen --------------------
function LoadingScreen({ progress, active }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    // When the loader is no longer active, wait for the fade-out animation before removing it from the DOM.
    if (!active) {
      const timer = setTimeout(() => setVisible(false), 800);
      return () => clearTimeout(timer);
    }
  }, [active]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: 'linear-gradient(180deg, #1a1c22, #0a0c0e)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        opacity: active ? 1 : 0,
        transition: 'opacity 0.8s ease-in-out',
        color: '#e9eef8',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <svg width="120" height="120" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.8 }}>
        <path d="M12 2L2 9.07V15.5L12 22L22 15.5V9.07L12 2Z" stroke="#e9eef8" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M2.5 9.5L12 15L21.5 9.5" stroke="#e9eef8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M12 22V15" stroke="#e9eef8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17.5 7L12 9.5L6.5 7" stroke="#e9eef8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      <h1 style={{ marginTop: 24, letterSpacing: '0.2em', textTransform: 'uppercase', fontWeight: 600, fontSize: 24 }}>
        Safe Glide
      </h1>
      <p style={{ marginTop: -10, color: '#a9b6d7', fontSize: 14 }}>
        SYSTEMS INITIALIZING
      </p>

      <div style={{ width: '240px', height: '2px', background: 'rgba(255, 255, 255, 0.15)', borderRadius: '1px', marginTop: 32, overflow: 'hidden' }}>
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: '#ffffff',
            borderRadius: '1px',
            transition: 'width 0.4s ease-out',
          }}
        />
      </div>
      <p style={{ marginTop: 12, fontSize: 14, color: '#a9b6d7' }}>
        {Math.round(progress)}% Loaded
      </p>
    </div>
  );
}

// -------------------- Progress Reporter --------------------
// Helper component to report loading progress from within the Canvas
function ProgressReporter({ onProgress }) {
  const { progress } = useProgress();
  useEffect(() => {
    onProgress(progress);
  }, [progress, onProgress]);
  return null; // This component is invisible
}


// -------------------- Utility --------------------
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function Banner({ label, tone = "warn" }) {
  const palette = {
    warn: { bg: "rgba(180, 75, 0, .9)", fg: "#fff" },
    danger: { bg: "rgba(160, 25, 25, .95)", fg: "#fff" },
    info: { bg: "rgba(20, 20, 25, .8)", fg: "#cfe3ff" },
  }[tone];

  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        transform: "translateX(-50%)",
        top: 68,
        zIndex: 140,
        padding: "6px 12px",
        background: palette.bg,
        color: palette.fg,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        borderRadius: 8,
        boxShadow: "0 10px 30px rgba(0,0,0,.6)",
        border: "1px solid rgba(255,255,255,.15)",
        textTransform: "uppercase",
        letterSpacing: 1.5,
        fontWeight: 800,
      }}
    >
      {label}
    </div>
  );
}

// -------------------- Right Control Panel --------------------
function ControlPanel({ settings, setSettings, onReset, canDeployAirbag, deployAirbag }) {
  const Chip = ({ active, label }) => (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        background: active ? "#0b7" : "#333",
        color: active ? "#001812" : "#bbb",
        fontSize: 11,
        marginLeft: 8,
      }}
    >
      {label}
    </span>
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 16,
        right: 16,
        width: 340,
        background: "linear-gradient(180deg, rgba(18,20,26,.96), rgba(8,10,14,.92))",
        color: "#e9eef8",
        padding: 14,
        borderRadius: 14,
        zIndex: 120,
        boxShadow: "0 20px 50px rgba(0,0,0,.55)",
        border: "1px solid rgba(255,255,255,.08)",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>Safe Glide Control</h3>
        <Chip active={settings.autopilot} label="Autopilot" />
      </div>

      <div style={{ height: 10 }} />

      <section style={{ borderTop: "1px solid #2a2f3a", paddingTop: 12 }}>
        <h4 style={{ margin: "0 0 8px 0", color: "#a9b6d7" }}>Assists & Failures</h4>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={settings.aiAssist}
            onChange={(e) => setSettings((s) => ({ ...s, aiAssist: e.target.checked }))}
          />
          {" "}AI Assist (auto-correct)
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={settings.autopilot}
            onChange={(e) => setSettings((s) => ({ ...s, autopilot: e.target.checked }))}
          />
          {" "}Autopilot (follow glidepath)
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={settings.gearFailure}
            onChange={(e) => setSettings((s) => ({ ...s, gearFailure: e.target.checked }))}
          />
          {" "}Gear Failure
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input
            type="checkbox"
            checked={settings.throttleFailure}
            onChange={(e) => setSettings((s) => ({ ...s, throttleFailure: e.target.checked }))}
          />
          {" "}Throttle Failure
        </label>
        <button
          onClick={() => setSettings((s) => (s.landingState !== "crashed" ? { ...s, birdStrike: true } : s))}
          style={{ width: "100%", marginTop: 6, padding: 10, background: "#c0392b", border: 0, color: "#fff", borderRadius: 8, cursor: "pointer" }}
        >
          TRIGGER BIRD STRIKE
        </button>
      </section>

      <section style={{ borderTop: "1px solid #2a2f3a", paddingTop: 12, marginTop: 12 }}>
        <h4 style={{ margin: "0 0 8px 0", color: "#a9b6d7" }}>Weather</h4>
        <label style={{ display: "block", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={settings.turbulence}
            onChange={(e) => setSettings((s) => ({ ...s, turbulence: e.target.checked }))}
          />
          {" "}Turbulence
        </label>
        <div style={{ marginBottom: 8 }}>
          <label>Wind Speed: {settings.windSpeed} kt</label>
          <input
            type="range"
            min="0"
            max="60"
            value={settings.windSpeed}
            onChange={(e) => setSettings((s) => ({ ...s, windSpeed: Number(e.target.value) }))}
            style={{ width: "100%" }}
          />
        </div>
        <div>
          <label>Wind Direction: {settings.windDirection}°</label>
          <input
            type="range"
            min="0"
            max="360"
            value={settings.windDirection}
            onChange={(e) => setSettings((s) => ({ ...s, windDirection: Number(e.target.value) }))}
            style={{ width: "100%" }}
          />
        </div>
      </section>

      <section style={{ borderTop: "1px solid #2a2f3a", paddingTop: 12, marginTop: 12 }}>
        <h4 style={{ margin: "0 0 8px 0", color: "#a9b6d7" }}>AI & System Log</h4>
        <div style={{ background: "#0a1218", height: 110, overflowY: "auto", padding: 8, borderRadius: 8, fontSize: 12 }}>
          {settings.log.slice(-10).map((entry, i) => (
            <div
              key={i}
              style={{
                marginBottom: 4,
                color: /critical|stall|bird|fire|crash|airbag/i.test(entry) ? "#ff7b7b" : "#cfe3ff",
              }}
            >
              {entry}
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <button onClick={onReset} style={{ flex: 1, padding: 10, background: "#2b6cb0", color: "#fff", border: 0, borderRadius: 8, cursor: "pointer" }}>RESET SIM</button>
          <button
            disabled={!canDeployAirbag}
            onClick={deployAirbag}
            style={{ flex: 1, padding: 10, background: canDeployAirbag ? "#f39c12" : "#5b4a2a", color: "#111", fontWeight: 800, border: 0, borderRadius: 8, cursor: canDeployAirbag ? "pointer" : "not-allowed" }}
          >
            DEPLOY AIRBAGS
          </button>
        </div>
      </section>
    </div>
  );
}

// -------------------- HUD (top bar like screenshot) --------------------
function HUD({ t }) {
  const knots = Math.max(0, t.speed * 1.94384).toFixed(0);
  const vsi = Math.round(t.vspeed); // ft/min like number
  const stall = t.stall ? "WARN" : "OK";
  return (
    <div style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", top: 14, zIndex: 130 }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, auto)",
          gap: 16,
          padding: "10px 14px",
          background: "linear-gradient(180deg, rgba(14,16,22,.75), rgba(10,12,16,.6))",
          borderRadius: 12,
          color: "#e9eef8",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          border: "1px solid rgba(255,255,255,.08)",
          boxShadow: "0 12px 40px rgba(0,0,0,.55)",
        }}
      >
        <div><div style={{ fontSize: 10, opacity: .75 }}>SPEED</div><div style={{ fontSize: 18, fontWeight: 800 }}>{knots} kt</div></div>
        <div><div style={{ fontSize: 10, opacity: .75 }}>ALT</div><div style={{ fontSize: 18, fontWeight: 800 }}>{t.altitude.toFixed(1)} m</div></div>
        <div><div style={{ fontSize: 10, opacity: .75 }}>V/S</div><div style={{ fontSize: 18, fontWeight: 800 }}>{vsi} f/m</div></div>
        <div>
          <div style={{ fontSize: 10, opacity: .75 }}>STALL</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: t.stall ? "#ff6969" : "#7efc82" }}>{stall}</div>
        </div>
      </div>
    </div>
  );
}

// -------------------- Landing Gear --------------------
function LandingGear({ touchdown, gearFailed }) {
  const mainGearLeft = useRef();
  const mainGearRight = useRef();
  const noseGear = useRef();
  useFrame(() => {
    const compression = touchdown ? 0.55 : 1;
    const damp = 0.08;
    for (const g of [mainGearLeft, mainGearRight, noseGear]) {
      if (g.current) g.current.scale.y += (compression - g.current.scale.y) * damp;
    }
  });
  if (gearFailed) return null;
  return (
    <group>
      <mesh ref={mainGearLeft} position={[-0.7, -0.8, -1]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, 1, 16]} />
        <meshStandardMaterial color="#888" metalness={.4} roughness={.5} />
      </mesh>
      <mesh ref={mainGearRight} position={[0.7, -0.8, -1]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, 1, 16]} />
        <meshStandardMaterial color="#888" metalness={.4} roughness={.5} />
      </mesh>
      <mesh ref={noseGear} position={[0, -0.6, 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.1, 0.8, 16]} />
        <meshStandardMaterial color="#888" metalness={.4} roughness={.5} />
      </mesh>
    </group>
  );
}

// -------------------- Particles --------------------
function Burst({ color, count, active, life = 1.6, size = .45, position = [0, 0, 0] }) {
  const ref = useRef();
  const clock = useRef(0);
  const pos = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 0] = (Math.random() - 0.5) * 3;
      arr[i * 3 + 1] = Math.random() * 2;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    return arr;
  }, [count]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    if (!active) {
      clock.current = 0; // Reset clock if not active
      ref.current.material.opacity = 0; // Ensure it's hidden
      return;
    }
    clock.current += delta;
    const a = ref.current.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      a[i] += (Math.random() - 0.5) * delta * 18;
      a[i + 1] += Math.random() * delta * 14;
      a[i + 2] += (Math.random() - 0.5) * delta * 18;
    }
    ref.current.material.opacity = Math.max(0, 1 - clock.current / life);
    ref.current.geometry.attributes.position.needsUpdate = true;
    if (clock.current > life) clock.current = 0; // loop fade for continuous effects
  });

  if (!active) return null;
  return (
    <points ref={ref} frustumCulled={false} position={position}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" count={count} array={pos} itemSize={3} />
      </bufferGeometry>
      <pointsMaterial size={size} color={color} transparent opacity={1} blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

// -------------------- Emergency Airbag --------------------
function Airbag({ armed, trigger, onTriggered }) {
  const group = useRef();
  const state = useRef({ scale: 0, deployed: false });

  // Reset state when trigger resets
  useEffect(() => {
    if (!trigger) {
      state.current.deployed = false;
      state.current.scale = 0;
    } else if (trigger && !state.current.deployed) {
      state.current.deployed = true;
      onTriggered?.();
    }
  }, [trigger, onTriggered]);

  useFrame((_, d) => {
    if (!group.current) return;
    if (!armed) return;

    if (state.current.deployed) {
      state.current.scale = THREE.MathUtils.lerp(state.current.scale, 1, d * 8); // Faster inflation
      group.current.scale.setScalar(state.current.scale);
    } else {
      group.current.scale.setScalar(0.0001);
    }
  });

  return (
    <group ref={group}>
      {/* Show airbag mesh only when deployed */}
      {state.current.deployed && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, 1]}>
          <cylinderGeometry args={[4.5, 4.5, 12, 64, 1, true]} />
          {/* ↑ radiusTop, radiusBottom, height, radialSegments, heightSegments, openEnded */}
          <meshStandardMaterial
            color="#ff7a00"
            emissive="#ff6a00"
            emissiveIntensity={0.4}
            roughness={0.4}
            transparent
            opacity={0.85}
            side={THREE.DoubleSide} // so inside is visible too
          />
        </mesh>
      )}
    </group>
  );
}

// -------------------- Airplane --------------------
function Airplane({ cameraRef, settings, setSettings, telemetryHook, manualDeploy }) {
  const { scene } = useGLTF("/airplane.glb");
  const ref = useRef();
  const [isAirbagTriggered, setAirbagTriggered] = useState(false);
  const [showBirdStrikeSmoke, setShowBirdStrikeSmoke] = useState(false);
  const cameraShakeIntensity = useRef(0);

  const sref = useRef({
    landingState: "approaching",
    rollSpeed: 26,
    velocityZ: 40,
    throttle: 1,
    damage: 0,
    flaps: 0,
    heading: 0,
    pitch: 0,
    vs: -200,
    postBirdStrikeRotationX: 0,
    postBirdStrikeRotationZ: 0,
  });

  useEffect(() => {
    setSettings((s) => ({ ...s, landingState: sref.current.landingState }));
    // Reset airbag state when sim resets
    if (settings.log.includes("Simulation Reset. Normal operations.")) {
      setAirbagTriggered(false);
      setShowBirdStrikeSmoke(false);
      cameraShakeIntensity.current = 0;
    }
  }, [setSettings, settings.log]);

  function aiAssist(delta) {
    const S = sref.current;
    const progress = clamp((ref.current.position.z - SIM_CONFIG.START_Z) / (SIM_CONFIG.TOUCHDOWN_Z - SIM_CONFIG.START_Z), 0, 1);
    const desiredAlt = lerp(SIM_CONFIG.START_Y, SIM_CONFIG.LANDING_ALTITUDE + 2, progress * progress);
    const altError = desiredAlt - ref.current.position.y;

    if (!settings.throttleFailure) {
      const speed = S.velocityZ * S.throttle;
      const tgt = SIM_CONFIG.BASE_SPEED;
      const err = tgt - speed;
      S.throttle = clamp(S.throttle + clamp(err * 0.0005 * delta * 60, -0.02, 0.02), 0, 1);
    }
    const pitchCorr = clamp(altError * 0.02, -0.03, 0.03);
    ref.current.rotation.x -= pitchCorr * delta * 10;
    ref.current.rotation.z *= 0.985;
    if (ref.current.position.z >= 420 && S.rollSpeed > 6) {
      S.rollSpeed = Math.max(6, S.rollSpeed - delta * 12);
    }
  }

  function evaluateRisk() {
    if (!ref.current) return false;
    const S = sref.current;
    const criticalAlt = ref.current.position.y < 70; // Increased altitude for earlier check
    const highDescRate = S.vs < -1000; // Lowered V/S threshold for earlier trigger
    const heavyDamage = S.damage > 0.7;
    const gearUnsafe = settings.gearFailure && ref.current.position.z > 100;
    const isStalling = S.velocityZ * S.throttle < 15 && ref.current.position.y < 20;
    const isCritical = highDescRate || heavyDamage || gearUnsafe || isStalling;
    return criticalAlt && isCritical;
  }

  useFrame((state, delta) => {
    if (!ref.current) return;
    const S = sref.current;

    const unrecoverable = evaluateRisk();
    if ((unrecoverable || manualDeploy) && !isAirbagTriggered) {
      setSettings((p) => ({ ...p, log: [...p.log, `AI: Unrecoverable state! Engaging airbag system.`] }));
      setAirbagTriggered(true);
      S.landingState = "emergency_descent";
    }

    // --- Weather Effects Application ---
    const windRad = (settings.windDirection * Math.PI) / 180;
    const crosswindEffect = Math.sin(windRad) * settings.windSpeed * 0.02;
    const headwindEffect = Math.cos(windRad) * settings.windSpeed * 0.1;

    if (S.landingState !== 'crashed' && S.landingState !== 'stopped') {
      ref.current.position.x -= crosswindEffect * delta;
      if (settings.turbulence) {
        const turbulenceIntensity = 0.4;
        ref.current.rotation.x += (Math.random() - 0.5) * turbulenceIntensity * delta;
        ref.current.rotation.z += (Math.random() - 0.5) * turbulenceIntensity * delta;
        ref.current.position.y += (Math.random() - 0.5) * turbulenceIntensity * 0.2 * delta;
        cameraShakeIntensity.current = lerp(cameraShakeIntensity.current, 1.5, delta);
      }
    }

    // --- Bird Strike Effect Update ---
    if (settings.birdStrike && !S._birdApplied && S.landingState !== "crashed") {
      S._birdApplied = true;
      S.damage = Math.min(1, S.damage + 0.55);
      setSettings((p) => ({ ...p, birdStrike: false, log: [...p.log, "BIRD STRIKE! Critical engine damage."] }));
      S.postBirdStrikeRotationX = 0.5;
      S.postBirdStrikeRotationZ = 0.35;
      cameraShakeIntensity.current = 3.0;
      setShowBirdStrikeSmoke(true);
      setTimeout(() => setShowBirdStrikeSmoke(false), 3000);
      S.throttle = Math.max(0, S.throttle - 0.6);
    }

    // Dampen post-bird strike rotation
    S.postBirdStrikeRotationX = lerp(S.postBirdStrikeRotationX, 0, delta * 3);
    S.postBirdStrikeRotationZ = lerp(S.postBirdStrikeRotationZ, 0, delta * 3);
    ref.current.rotation.x += S.postBirdStrikeRotationX * delta * 2;
    ref.current.rotation.z += S.postBirdStrikeRotationZ * delta * 2;
    if (Math.abs(S.postBirdStrikeRotationX) < 0.01) S.postBirdStrikeRotationX = 0;
    if (Math.abs(S.postBirdStrikeRotationZ) < 0.01) S.postBirdStrikeRotationZ = 0;

    const landingAlt = SIM_CONFIG.LANDING_ALTITUDE;
    const base = settings.throttleFailure ? SIM_CONFIG.THROTTLE_FAILURE_SPEED : SIM_CONFIG.BASE_SPEED;
    S.velocityZ = (base * S.throttle + (settings.autopilot ? 6 : 0)) - headwindEffect;

    switch (S.landingState) {
      case "approaching": {
        const startZ = SIM_CONFIG.START_Z;
        const touchdownZ = SIM_CONFIG.TOUCHDOWN_Z;
        ref.current.position.z += S.velocityZ * delta;
        const progress = clamp((ref.current.position.z - startZ) / (touchdownZ - startZ), 0, 1);
        const eased = progress * progress;
        const targetY = lerp(SIM_CONFIG.START_Y, landingAlt + 6, eased);
        S.vs = (targetY - ref.current.position.y) * 70 * -40;
        ref.current.position.y = targetY;
        ref.current.rotation.x = SIM_CONFIG.APPROACH_ROTATION;
        if (ref.current.position.z >= touchdownZ - 90) S.landingState = "flaring";
        break;
      }
      case "flaring": {
        ref.current.position.z += Math.max(18, S.velocityZ * 0.8) * delta;
        ref.current.rotation.x = lerp(ref.current.rotation.x, SIM_CONFIG.FLARE_PULL_UP_ROTATION, delta * 2);
        const targetY = lerp(ref.current.position.y, landingAlt + 0.1, delta * 0.9);
        S.vs = (targetY - ref.current.position.y) * 70 * -40;
        ref.current.position.y = targetY;
        if (ref.current.position.y <= landingAlt + 0.05) {
          if (settings.gearFailure || S.damage > 0.55) {
            setSettings((p) => ({ ...p, log: [...p.log, "CRITICAL: gear collapse / severe damage → crash"], }));
            S.landingState = "crashed";
          } else {
            S.landingState = "touchdown";
          }
        }
        break;
      }
      case "emergency_descent": {
        ref.current.rotation.x = lerp(ref.current.rotation.x, 0, delta * 1.5);
        ref.current.rotation.z = lerp(ref.current.rotation.z, 0, delta * 1.5);
        ref.current.position.y = Math.max(landingAlt, ref.current.position.y - delta * 5.0);
        S.vs = -980;
        ref.current.position.z += 15 * delta;
        if (ref.current.position.y <= landingAlt) {
          S.landingState = "rolling";
          S.rollSpeed = 8;
          setSettings((p) => ({ ...p, log: [...p.log, "AIRBAG LANDING: Cushioned impact."] }))
        }
        break;
      }
      case "touchdown": {
        ref.current.position.y = landingAlt;
        S.landingState = "rolling";
        break;
      }
      case "rolling": {
        const decel = isAirbagTriggered ? 22 : (settings.throttleFailure ? 11 : 7);
        ref.current.position.z += S.rollSpeed * delta * (1 - S.damage * 0.6);
        S.rollSpeed = Math.max(0, S.rollSpeed - delta * decel - S.damage * delta * 8);
        if (ref.current.position.z >= SIM_CONFIG.RUNWAY_END_Z || S.rollSpeed <= 0.05) S.landingState = "stopped";
        break;
      }
      case "crashed": {
        if (ref.current.position.y > SIM_CONFIG.CRASH_GROUND_Y) {
          ref.current.position.y -= delta * (22 + 40 * S.damage);
          ref.current.rotation.x += delta * (2 + 3 * S.damage);
          ref.current.rotation.z += delta * (1.5 + 3 * S.damage);
        } else {
          ref.current.position.y = SIM_CONFIG.CRASH_GROUND_Y;
          ref.current.position.z += S.rollSpeed * delta * 0.5;
          S.rollSpeed = Math.max(0, S.rollSpeed - delta * (22 + 38 * S.damage));
        }
        break;
      }
      default:
        break;
    }

    if (settings.aiAssist && (S.landingState === "approaching" || S.landingState === "flaring")) {
      aiAssist(delta);
    }

    if (cameraRef.current) {
      const shakeX = (Math.random() - 0.5) * cameraShakeIntensity.current * 0.1;
      const shakeY = (Math.random() - 0.5) * cameraShakeIntensity.current * 0.1;
      const shakeZ = (Math.random() - 0.5) * cameraShakeIntensity.current * 0.1;
      const lookAt = ref.current.position.clone().add(new THREE.Vector3(0, 5, 50));
      let target;
      if (S.landingState === "crashed") {
        target = ref.current.position.clone().add(new THREE.Vector3(shakeX, SIM_CONFIG.CAMERA_FOLLOW_HEIGHT_Y + S.damage * 20 + shakeY, SIM_CONFIG.CAMERA_FOLLOW_DISTANCE_Z + shakeZ));
      } else if (S.landingState === "approaching" || S.landingState === "flaring" || S.landingState === "emergency_descent") {
        target = ref.current.position.clone().add(new THREE.Vector3(shakeX, SIM_CONFIG.CAMERA_FOLLOW_HEIGHT_Y + shakeY, SIM_CONFIG.CAMERA_FOLLOW_DISTANCE_Z + shakeZ));
      } else {
        target = ref.current.position.clone().add(new THREE.Vector3(shakeX, 40 + shakeY, -100 + shakeZ));
      }
      cameraRef.current.position.lerp(target, delta * 2);
      cameraRef.current.lookAt(lookAt);
      cameraShakeIntensity.current = lerp(cameraShakeIntensity.current, 0, delta * 2);
    }

    telemetryHook({
      speed: (S.landingState === "rolling" || S.landingState === "stopped") ? S.rollSpeed : S.velocityZ,
      altitude: ref.current.position.y,
      throttle: S.throttle,
      vspeed: S.vs,
      stall: S.velocityZ * S.throttle < 16 || S.vs < -1200,
      landingState: S.landingState,
    });
  });

  const showGroundSmoke = ["touchdown", "rolling"].includes(sref.current.landingState) && !isAirbagTriggered;

  return (
    <group ref={ref} position={[0, SIM_CONFIG.START_Y, SIM_CONFIG.START_Z]} rotation={[0, 0, 0]} scale={3}>
      <primitive object={scene} />
      <LandingGear touchdown={sref.current.landingState !== "approaching"} gearFailed={settings.gearFailure} />
      {showGroundSmoke && <Burst color="white" count={110} active life={1.8} size={0.5} />}
      {showBirdStrikeSmoke && <Burst color="black" count={150} active life={1.0} size={0.8} position={[0, 0, -3]} />} {/* Smoke from engine */}
      <Airbag armed={true} trigger={isAirbagTriggered} onTriggered={() => { }} />
    </group>
  );
}

// -------------------- Runway --------------------
function Runway() {
  const { scene } = useGLTF("/runway.glb");
  return <primitive object={scene} scale={1} />;
}

// -------------------- Ocean --------------------
function Ocean() {
  const ref = useRef();
  useEffect(() => {
    const geo = new THREE.PlaneGeometry(5000, 5000);
    const water = new Water(geo, {
      textureWidth: 512,
      textureHeight: 512,
      waterNormals: new THREE.TextureLoader().load(
        "https://threejs.org/examples/textures/waternormals.jpg",
        (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        }
      ),
      sunDirection: new THREE.Vector3(),
      sunColor: 0xffffff,
      waterColor: 0x001e0f,
      distortionScale: 3.5,
      fog: true,
    });
    water.rotation.x = -Math.PI / 2;
    ref.current.add(water);
  }, []);
  return <group ref={ref} position={[0, -0.1, 0]} />;
}

// -------------------- Main --------------------
export default function SafeGlideApp() {
  const cameraRef = useRef();
  const [simKey, setSimKey] = useState(1);
  const [progress, setProgress] = useState(0);
  const [isStarted, setIsStarted] = useState(false);
  const [telemetry, setTelemetry] = useState({ speed: 20, altitude: 90, throttle: 1, heading: 0, windSpeed: 6, windDir: 90, landingState: "approaching", damage: 0, vspeed: -200, stall: false });
  const [airbagClicked, setAirbagClicked] = useState(false);

  const [settings, setSettings] = useState({
    gearFailure: false,
    throttleFailure: false,
    birdStrike: false,
    turbulence: false,
    windSpeed: 6,
    windDirection: 90,
    landingState: "approaching",
    log: ["Normal operations."],
    aiAssist: true,
    autopilot: true,
  });

  // When loading is 100% complete, start the simulation experience.
  useEffect(() => {
    if (progress >= 100) {
      const timer = setTimeout(() => setIsStarted(true), 500);
      return () => clearTimeout(timer);
    }
  }, [progress]);

  const resetSimulation = () => {
    setSettings({
      gearFailure: false,
      throttleFailure: false,
      birdStrike: false,
      turbulence: false,
      windSpeed: 6,
      windDirection: 90,
      landingState: "approaching",
      log: ["Simulation Reset. Normal operations."],
      aiAssist: true,
      autopilot: true,
    });
    setTelemetry({ speed: 20, altitude: 90, throttle: 1, heading: 0, windSpeed: 6, windDir: 90, landingState: "approaching", damage: 0, vspeed: -200, stall: false });
    setAirbagClicked(false);
    setSimKey((p) => p + 1);
  };

  useEffect(() => {
    const id = setInterval(() => setTelemetry((t) => ({ ...t, windSpeed: settings.windSpeed, windDir: settings.windDirection })), 200);
    return () => clearInterval(id);
  }, [settings.windSpeed, settings.windDirection]);

  const [uiFlags, setUiFlags] = useState({ showStall: false, showBird: false, showGear: false });
  useEffect(() => {
    const lastLog = settings.log.at(-1) || "";
    if (/BIRD STRIKE/i.test(lastLog)) {
      setUiFlags((f) => ({ ...f, showBird: true }));
      const timer = setTimeout(() => setUiFlags((f) => ({ ...f, showBird: false })), 4000);
      return () => clearTimeout(timer);
    }
  }, [settings.log]);

  const telemetryHook = (t) => {
    setTelemetry(t);
    setUiFlags((f) => ({
      ...f,
      showStall: t.stall,
      showGear: settings.gearFailure && (t.landingState === "flaring" || t.landingState === "approaching"),
    }));
  };

  const canDeployAirbag = telemetry.altitude < 50 && (telemetry.vspeed < -900 || settings.gearFailure || telemetry.damage > 0.6);

  // Dynamic Sky and Environment settings
  const skyProps = useMemo(() => {
    if (settings.turbulence) {
      return {
        sunPosition: [10, 5, 10], // Lower sun for darker atmosphere
        turbidity: 15, // More atmospheric haze
        rayleigh: 5,   // More scattering, darker blue/grey
        mieCoefficient: 0.01, // More particles, cloudy
        mieDirectionalG: 0.8, // Directional light scattering
        inclination: 0.3, // Lower sun angle
        azimuth: 0.25, // Sun direction
      };
    }
    return {
      sunPosition: [100, 20, 100],
      turbidity: 8,
      rayleigh: 3,
      mieCoefficient: 0.005,
      mieDirectionalG: 0.7,
      inclination: 0.49,
      azimuth: 0.25,
    };
  }, [settings.turbulence]);

  const environmentPreset = settings.turbulence ? "night" : "sunset";


  return (
    <div style={{ height: "100vh", width: "100vw", background: "#000", overflow: "hidden", position: 'relative' }}>
      <LoadingScreen progress={progress} active={!isStarted} />

      {/* Only render the main UI once the simulation has started */}
      {isStarted && (
        <>
          <ControlPanel
            settings={settings}
            setSettings={setSettings}
            onReset={resetSimulation}
            canDeployAirbag={canDeployAirbag}
            deployAirbag={() => setAirbagClicked(true)}
          />
          <HUD t={telemetry} />
          {uiFlags.showStall && <Banner label="STALL WARNING" tone="danger" />}
          {uiFlags.showBird && <Banner label="BIRD STRIKE" tone="danger" />}
          {uiFlags.showGear && <Banner label="GEAR UNSAFE" tone="warn" />}
        </>
      )}

      <Canvas key={simKey} shadows>
        <PerspectiveCamera ref={cameraRef} makeDefault fov={75} position={[0, 40, -200]} />
        <color attach="background" args={settings.turbulence ? ["#607d8b"] : ["#87ceeb"]} /> {/* Darker background for storm */}
        <ambientLight intensity={settings.turbulence ? 0.3 : 0.7} /> {/* Lower ambient light */}
        <directionalLight position={[100, 200, 100]} intensity={settings.turbulence ? 0.8 : 1.6} castShadow /> {/* Adjust dir light */}
        <Suspense fallback={null}>
          <Ocean />
          <Runway />
          <Airplane
            cameraRef={cameraRef}
            settings={settings}
            setSettings={setSettings}
            telemetryHook={telemetryHook}
            manualDeploy={airbagClicked}
          />
          <Sky {...skyProps} /> {/* Apply dynamic sky props */}
          <Environment preset={environmentPreset} /> {/* Apply dynamic environment preset */}
          <ProgressReporter onProgress={setProgress} />
        </Suspense>
      </Canvas>
    </div>
  );
}
