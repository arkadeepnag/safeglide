import React, { useRef, useState, Suspense, useEffect } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF, OrbitControls } from "@react-three/drei"; // Import OrbitControls
import {
  Box,
  Switch,
  FormControlLabel,
  Slider,
  Button,
  Typography,
  Stack,
} from "@mui/material";
import * as THREE from "three";

// helpers
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

// Model loader hook
function usePlaneModel(path = "/scene.gltf") {
  return useGLTF(path);
}

/* Runway: fixed in world space, long along X-axis, centerline at z=0 */
function Runway({ length = 2000, width = 60 }) {
  const centerline = [];
  for (let i = -length / 2; i < length / 2; i += 30) {
    centerline.push(
      <mesh key={i} position={[i, 0.02, 0]}>
        <boxGeometry args={[10, 0.02, 1]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    );
  }
  const threshold = [];
  for (let j = -width / 2 + 6; j <= width / 2 - 6; j += 6) {
    threshold.push(
      <mesh key={"thr" + j} position={[-length / 2 + 18, 0.02, j]}>
        <boxGeometry args={[3.5, 0.02, 3.5]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
    );
  }
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <planeGeometry args={[length, width]} />
        <meshStandardMaterial color="#1d1e20" />
      </mesh>
      {centerline}
      {threshold}
    </group>
  );
}

/* AirbagCushion: A large, rounded, translucent orange cushion that inflates under the plane. */
function AirbagCushion({ deployed = false }) {
  const bagRef = useRef();
  useFrame((_, delta) => {
    if (!bagRef.current) return;
    const targetScale = deployed ? 1.0 : 0.001; // Inflate scale
    const targetYOffset = deployed ? 0 : -2; // Slightly lift off the ground when deployed

    // Smoothly scale the airbag
    bagRef.current.scale.y = lerp(bagRef.current.scale.y, targetScale, 0.08);
    bagRef.current.scale.x = lerp(bagRef.current.scale.x, targetScale, 0.08);
    bagRef.current.scale.z = lerp(bagRef.current.scale.z, targetScale, 0.08);

    // Adjust opacity based on inflation
    bagRef.current.material.opacity = clamp(bagRef.current.scale.y * 0.7, 0.0, 0.8);

    // Adjust position for inflation
    bagRef.current.position.y = lerp(bagRef.current.position.y, targetYOffset, 0.08);
  });

  return (
    <group>
      {/* CapsuleGeometry for a more realistic elongated airbag shape */}
      <mesh ref={bagRef} position={[0, -2, 0]} rotation={[0, 0, Math.PI / 2]}> {/* Rotate to lie flat */}
        <capsuleGeometry args={[8, 30, 8, 16]} /> {/* Radius, Length, Radial Segments, Cap Segments */}
        <meshStandardMaterial
          color="#ff8c00" /* Orange color */
          transparent
          opacity={0.0} // Starts invisible
          metalness={0.1}
          roughness={0.7}
        />
      </mesh>
    </group>
  );
}

/* CameraRig: Now simply clamps the camera's position to prevent going underground. */
function CameraRig() {
  const { camera } = useThree();
  useFrame(() => {
    // Prevent camera from going below the ground (Y = 0)
    if (camera.position.y < 0.5) {
      camera.position.y = 0.5;
    }
  });
  return null;
}

/* Plane component: Final corrected version with stable AI and physics. */
function Plane({ state, planeRef }) {
  const gltf = usePlaneModel(state.model);
  const animatedParts = useRef({});
  const glowFactors = useRef({ aileron: 0, elevator: 0, rudder: 0 }).current;

  // physical state (meters, m/s)
  const phys = useRef({
    pos: [2000, 250, 0],
    vel: [-74, -3, 0], // Corrected initial velocity
    pitch: -0.02,
    roll: 0,
    yaw: 0,
    deployedCushion: false,
    damage: 0,
    onGround: false,
    lastCrossErrI: 0,
  }).current;

  // constants
  const WING_AREA = 120, MASS = 42000, GRAVITY = -9.81, CL0 = 0.25, CL_ALPHA = 5.5, MAX_THRUST = 250000, FLARE_ALT = 8.0;

  // PID gains for lateral alignment
  const PID_KP = 0.14, PID_KI = 0.006, PID_KD = 0.04;

  // On model load, find and store references to animatable parts
  useEffect(() => {
    if (!gltf.scene) return;
    animatedParts.current = {};
    gltf.scene.traverse(node => {
      if (node.isMesh) {
        if (node.name.toLowerCase().includes('aileron')) animatedParts.current.aileron = node;
        if (node.name.toLowerCase().includes('elevator')) animatedParts.current.elevator = node;
        if (node.name.toLowerCase().includes('rudder')) animatedParts.current.rudder = node;
      }
    });
    Object.values(animatedParts.current).forEach(part => {
        if (part.material) {
            part.material = part.material.clone();
        }
    })
  }, [gltf.scene]);
  
  // Reset simulation state
  useEffect(() => {
    if (state.resetFlag) {
      phys.pos = [2000, 250, 0];
      phys.vel = [-74, -3, 0];
      phys.pitch = -0.02; phys.roll = 0; phys.yaw = 0;
      phys.deployedCushion = false; phys.damage = 0; phys.onGround = false;
      phys.lastCrossErrI = 0;
      state.setResetFlag(false);
    }
  }, [state.resetFlag, phys, state]);
  
  // Handle bird strike event
  useEffect(() => {
    if (state.birdStrike) {
      phys.damage = clamp(phys.damage + 0.25, 0, 1.0);
      phys.roll += (Math.random() - 0.5) * 0.15;
      phys.vel[2] += (Math.random() - 0.5) * 2.0;
      state.pushAiLog("Bird strike: significant damage + roll perturbation");
      state.setBirdStrike(false);
    }
  }, [state.birdStrike, phys, state]);

  useFrame((_, delta) => {
    delta = Math.min(delta, 0.05);
    let [vx, vy, vz] = phys.vel;

    const authority = clamp(1 - phys.damage * 0.7, 0.15, 1);
    const icingEffect = state.icing ? { drag: 1.5, lift: 0.85 } : { drag: 1.0, lift: 1.0 };
    if (state.turbulence) {
        phys.roll += (Math.random() - 0.5) * 0.004;
        phys.pitch += (Math.random() - 0.5) * 0.002;
    }

    const flightPathAngle = Math.atan2(vy, Math.max(1e-3, Math.abs(vx)));
    const aoa = phys.pitch - flightPathAngle;
    const cl = (CL0 + CL_ALPHA * aoa) * icingEffect.lift;
    const lift = 0.5 * 1.225 * vx * vx * WING_AREA * cl;
    const drag = (30.0 * vx * vx * (1 + Math.abs(aoa) * 2.0)) * icingEffect.drag;
    const thrust = (state.throttle / 100) * (state.throttleFailure ? MAX_THRUST * 0.35 : MAX_THRUST);

    const crossErr = phys.pos[2];
    phys.lastCrossErrI = clamp(phys.lastCrossErrI + crossErr * delta, -500, 500);
    const crossErrD = (crossErr - (phys._lastCrossErr || 0)) / delta;
    phys._lastCrossErr = crossErr;
    const rudderCmd = -(PID_KP * crossErr + PID_KI * phys.lastCrossErrI + PID_KD * crossErrD) * authority;
    phys.yaw += (rudderCmd - phys.yaw) * clamp(0.12 * authority, 0.02, 0.25);
    phys.roll = lerp(phys.roll, phys.yaw * 0.8, 0.1);
    glowFactors.rudder = lerp(glowFactors.rudder, Math.abs(rudderCmd) > 0.01 ? 1 : 0, 0.1);

    const windSpeedMS = state.windSpeed * 0.514444;
    const windDirRad = state.windDir * Math.PI / 180;
    const windZ = Math.sin(windDirRad) * windSpeedMS;
    vz += (windZ * 0.08) * (1 - phys.damage * 0.5) * delta;

    if (state.aiEnabled && !phys.onGround && phys.pos[0] > -200) {
      const distanceToThresh = phys.pos[0];
      const desiredAltitude = clamp(distanceToThresh / 19 + state.approachAltitude, 0, 400);
      const altErr = phys.pos[1] - desiredAltitude;
      let pitchCmd = -clamp(altErr * 0.0016, -0.25, 0.25);
      const ks = Math.abs(vx * 1.944);
      if (ks > state.targetSpeed + 8) pitchCmd += 0.01 * authority;
      phys.pitch = lerp(phys.pitch, pitchCmd, 0.06 * authority);
      glowFactors.elevator = lerp(glowFactors.elevator, Math.abs(pitchCmd - phys.pitch) > 0.001 ? 1 : 0, 0.1);
    } else if (phys.onGround) {
        phys.pitch = lerp(phys.pitch, 0, 0.05); 
    }
    glowFactors.aileron = lerp(glowFactors.aileron, state.aiEnabled ? 1 : 0, 0.1);

    if (!phys.onGround && phys.pos[1] < FLARE_ALT && phys.pos[0] > -200 && phys.pos[0] < 50) {
      const flareFactor = clamp((FLARE_ALT - phys.pos[1]) / FLARE_ALT, 0, 1);
      const flarePitch = 0.09 * flareFactor * authority;
      phys.pitch = lerp(phys.pitch, flarePitch, 0.18);
    }

    vy += ((lift / MASS) + GRAVITY) * delta;
    vx += ((-thrust + drag) / MASS) * delta;
    
    phys.pos[0] += vx * Math.cos(phys.yaw) * delta;
    phys.pos[1] += vy * delta;
    phys.pos[2] += (vx * Math.sin(phys.yaw) + vz) * delta;

    const stall = Math.abs(vx) < 55 || cl < 0.12;
    if (!phys.deployedCushion && ((stall && phys.pos[1] < 30) || (state.gearFailure && phys.pos[1] < 8))) {
      phys.deployedCushion = true;
      state.setCushionDeployed(true);
      state.pushAiLog("AI: Unrecoverable state. Deploying emergency cushions.");
    }
    
    if (phys.pos[1] <= 0.5 && !phys.onGround) { 
      phys.onGround = true;
      phys.pos[1] = 0.5;
      const touchdownKts = Math.abs(vx * 1.944);
      if (state.gearFailure) {
        vx *= phys.deployedCushion ? 0.55 : 0.25;
        phys.damage = clamp(phys.damage + 0.4 + (touchdownKts > 80 ? 0.3: 0), 0, 1.2);
        state.pushAiLog(`GEARLESS LANDING at ${Math.round(touchdownKts)} kts.`);
      } else {
        phys.damage = clamp(phys.damage + (touchdownKts > 100 ? 0.2 : 0.02), 0, 1.0);
        state.pushAiLog(`Normal touchdown at ${Math.round(touchdownKts)} kts.`);
      }
    }
    if (phys.onGround) {
        vy = 0;
        phys.roll = lerp(phys.roll, 0, 0.1);
        const friction = state.gearFailure ? (phys.deployedCushion ? 0.2 : 0.4) : 0.04;
        vx *= 1 - (friction + state.brakeForce) * delta * 5;
        vz *= 0.92;
        if (Math.abs(vx) < 0.5) {
            vx = 0;
            vz = 0;
            phys.yaw = lerp(phys.yaw, 0, 0.1);
        }
    }
    phys.vel = [vx, vy, vz];

    // --- Visuals ---
    if (planeRef.current) {
      planeRef.current.position.set(phys.pos[0], phys.pos[1], phys.pos[2]);
      planeRef.current.rotation.set(phys.pitch, -phys.yaw, phys.roll);
    }
    if (animatedParts.current.aileron) animatedParts.current.aileron.rotation.x = -phys.roll * 2.5;
    if (animatedParts.current.elevator) animatedParts.current.elevator.rotation.x = -phys.pitch * 3.0;
    if (animatedParts.current.rudder) animatedParts.current.rudder.rotation.y = -phys.yaw * 4.0;
    const glowColor = new THREE.Color("#ffff00");
    if (animatedParts.current.aileron) animatedParts.current.aileron.material.emissive.copy(glowColor).multiplyScalar(glowFactors.aileron);
    if (animatedParts.current.elevator) animatedParts.current.elevator.material.emissive.copy(glowColor).multiplyScalar(glowFactors.elevator);
    if (animatedParts.current.rudder) animatedParts.current.rudder.material.emissive.copy(glowColor).multiplyScalar(glowFactors.rudder);

    state.setTelemetry(t => ({...t, altitude: Math.round(phys.pos[1]), speed: Math.round(Math.abs(vx * 1.944)), verticalSpeed: Math.round(vy * 197), stall, cushion: phys.deployedCushion, onGround: phys.onGround, damage: Math.round(phys.damage * 100)}));
  });

  return (
    <group ref={planeRef} dispose={null}>
        {/* **FIXED**: Corrected rotation for the GLTF model to be right-side up and facing -X (towards runway) */}
        <group rotation={[0, Math.PI / 2, Math.PI]}> {/* Rotate 180 deg around Z to flip, then 90 deg around Y to face -X */}
            <primitive object={gltf.scene} />
        </group>
        {/* Airbag is now centered at the plane's origin */}
        <group position={[0, 0, 0]}>
            <AirbagCushion deployed={state.cushionDeployed} />
        </group>
    </group>
  );
}

/* HUD (unchanged) */
function HUD({ telemetry }) {
    return (
      <div style={{ position: 'absolute', left: '50%', top: '5%', transform: 'translateX(-50%)', zIndex: 100, pointerEvents: 'none', color: 'white', minWidth: 400, textAlign: 'center', fontFamily: 'monospace' }}>
        <div style={{ backdropFilter: 'blur(4px)', background: 'rgba(0,0,0,0.3)', padding: '8px 16px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
            <div><Typography variant="caption" sx={{ color: '#aee3ff' }}>SPEED</Typography><div style={{ fontSize: 20 }}>{telemetry.speed} kts</div></div>
            <div><Typography variant="caption" sx={{ color: '#aee3ff' }}>ALT</Typography><div style={{ fontSize: 20 }}>{telemetry.altitude} m</div></div>
            <div><Typography variant="caption" sx={{ color: '#aee3ff' }}>V/S</Typography><div style={{ fontSize: 20 }}>{telemetry.verticalSpeed} ft/m</div></div>
            <div><Typography variant="caption" sx={{ color: '#aee3ff' }}>DMG</Typography><div style={{ fontSize: 20, color: telemetry.damage > 50 ? '#ff6b6b' : 'white' }}>{telemetry.damage}%</div></div>
            <div><Typography variant="caption" sx={{ color: '#aee3ff' }}>STALL</Typography><div style={{ fontSize: 20, color: telemetry.stall ? '#ff6b6b' : '#9ef08a' }}>{telemetry.stall ? 'WARN' : 'NO'}</div></div>
          </div>
        </div>
      </div>
    );
  }

/* Main App */
export default function App() {
  const [aiEnabled, setAiEnabled] = useState(true);
  const [gearFailure, setGearFailure] = useState(false);
  const [throttleFailure, setThrottleFailure] = useState(false);
  const [birdStrike, setBirdStrike] = useState(false);
  const [turbulence, setTurbulence] = useState(false);
  const [icing, setIcing] = useState(false);
  const [windSpeed, setWindSpeed] = useState(6);
  const [windDir, setWindDir] = useState(90);
  const [throttle, setThrottle] = useState(62);
  const [approachAltitude, setApproachAltitude] = useState(18);
  const [cushionDeployed, setCushionDeployed] = useState(false);
  const [telemetry, setTelemetry] = useState({ altitude: 300, speed: 70, verticalSpeed: 0, stall: false, cushion: false, onGround: false, damage: 0 });
  const [aiLog, setAiLog] = useState([]);
  const [resetFlag, setResetFlag] = useState(false);
  const [brakeForce, setBrakeForce] = useState(0.12);
  
  const planeRef = useRef();

  function pushAiLog(msg) {
    setAiLog(l => [`${new Date().toLocaleTimeString()}: ${msg}`, ...l.slice(0, 24)]);
  }

  useEffect(() => {
    pushAiLog("Simulation ready.");
  }, []);

  const state = {
    aiEnabled, model: "/scene.gltf", birdStrike, setBirdStrike, throttleFailure, gearFailure, windSpeed, windDir, throttle, approachAltitude, cushionDeployed, setCushionDeployed, resetFlag, setResetFlag, setTelemetry, pushAiLog, targetSpeed: 85, brakeForce, turbulence, icing
  };

  function resetSim() {
    setResetFlag(true);
    setAiLog([]); pushAiLog("Simulation reset.");
    setCushionDeployed(false);
    setTelemetry({ altitude: 250, speed: 74, verticalSpeed: -3, stall: false, cushion: false, onGround: false, damage: 0 });
  }

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw', background: '#07070a' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <HUD telemetry={telemetry} />
        <Canvas camera={{ position: [-150, 80, 0], fov: 45 }}> {/* Adjusted initial camera position for better overview */}
          <fog attach="fog" args={['#1c2436', 1000, 6000]} />
          <ambientLight intensity={0.8} />
          <directionalLight position={[30, 60, 40]} intensity={2.5} castShadow />
          <Suspense fallback={null}>
            <Runway length={4000} width={60} />
            <Plane state={state} planeRef={planeRef} />
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.2, 0]}>
              <planeGeometry args={[8000, 8000]} />
              <meshStandardMaterial color="#0c1a1e" />
            </mesh>
            <CameraRig /> {/* CameraRig for clamping, OrbitControls handles movement */}
            <OrbitControls minPolarAngle={0} maxPolarAngle={Math.PI / 2.05} /> {/* Re-enabled OrbitControls with min/max polar angle to prevent going below ground */}
          </Suspense>
        </Canvas>
      </div>

      <Box sx={{ width: 360, p: 2, background: '#0f1720', color: 'white', overflowY: 'auto' }}>
        <Typography variant="h6">Safe Glide Control</Typography>
        <Stack spacing={1} sx={{ mt: 1 }}>
          <FormControlLabel control={<Switch color="info" checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />} label="AI Autopilot" />
          <Typography variant="subtitle2" sx={{pt: 1}}>Failure Scenarios</Typography>
          <FormControlLabel control={<Switch color="warning" checked={gearFailure} onChange={(e) => setGearFailure(e.target.checked)} />} label="Gear Failure" />
          <FormControlLabel control={<Switch color="warning" checked={throttleFailure} onChange={(e) => setThrottleFailure(e.target.checked)} />} label="Throttle Failure" />
          <Button sx={{justifyContent: 'flex-start'}} size="small" variant="text" color="warning" onClick={() => setBirdStrike(true)}>Trigger Bird Strike</Button>
          
          <Typography variant="subtitle2" sx={{pt: 1}}>Weather Conditions</Typography>
          <FormControlLabel control={<Switch color="secondary" checked={turbulence} onChange={(e) => setTurbulence(e.target.checked)} />} label="Turbulence" />
          <FormControlLabel control={<Switch color="secondary" checked={icing} onChange={(e) => setIcing(e.target.checked)} />} label="Icing Conditions" />
          <Typography>Wind Speed: {windSpeed} knots</Typography>
          <Slider value={windSpeed} min={0} max={50} onChange={(_, v) => setWindSpeed(v)} />
          <Typography>Wind Direction: {windDir}°</Typography>
          <Slider value={windDir} min={0} max={360} onChange={(_, v) => setWindDir(v)} />
          
          <Typography variant="subtitle2" sx={{pt: 1}}>Aircraft Controls</Typography>
          <Typography>Throttle: {throttle}%</Typography>
          <Slider value={throttle} min={0} max={100} onChange={(_, v) => setThrottle(v)} />
          <Typography>Approach Altitude Offset: {approachAltitude} m</Typography>
          <Slider value={approachAltitude} min={-20} max={100} onChange={(_, v) => setApproachAltitude(v)} />
          <Typography>Brake Force (On Ground)</Typography>
          <Slider value={brakeForce} min={0.02} max={0.4} step={0.01} onChange={(_, v) => setBrakeForce(v)} />

          <Stack direction="row" spacing={1} sx={{pt: 2}}>
            <Button variant="contained" onClick={() => resetSim()}>Reset Sim</Button>
            <Button variant="outlined" color="error" onClick={() => { setCushionDeployed(true); pushAiLog("Manual cushion deploy."); }}>Deploy Airbags</Button>
          </Stack>

          <Box sx={{ mt: 2, p: 1, background: 'rgba(0,0,0,0.2)', borderRadius: 1}}>
             <Typography variant="subtitle2">AI & System Log</Typography>
             <Box sx={{ mt: 1, height: 180, overflowY: "auto", fontFamily: 'monospace', fontSize: 12 }}>
               {aiLog.map((l, i) => (<Typography key={i} sx={{ fontSize: 12 }}>{l}</Typography>))}
             </Box>
           </Box>
        </Stack>
      </Box>
    </div>
  );
}