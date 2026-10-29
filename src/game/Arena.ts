import * as THREE from "three";
import { COLORS, TAU, canvasTexture, makeCanvas, pick, rand, randInt } from "./utils";
import { PROJECTS } from "./names";

const SLOGANS = [
  ["SYNERGY", "Q4 / ALL HANDS"],
  ["PIVOT", "OR PERISH"],
  ["QUICK CALL?", "15 MIN. HARD STOP."],
  ["THOUGHT", "LEADERSHIP"],
  ["DISRUPT", "EVERYTHING"],
  ["FAMILY", "WE'RE LIKE A FAMILY"],
  ["ALIGN", "ON ALIGNMENT"],
  ["SHIP IT", "FRIDAY / 17:59"],
] as const;

function gridTexture(): THREE.Texture {
  const ctx = makeCanvas(256, 256);
  ctx.clearRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(120, 96, 255, 0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, 254, 254);
  ctx.strokeStyle = "rgba(255, 46, 136, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(128, 0);
  ctx.lineTo(128, 256);
  ctx.moveTo(0, 128);
  ctx.lineTo(256, 128);
  ctx.stroke();
  const tex = canvasTexture(ctx);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 26);
  return tex;
}

function screenTexture(title: string, sub: string, index: number): THREE.Texture {
  const ctx = makeCanvas(640, 360);
  ctx.fillStyle = "#0a0816";
  ctx.fillRect(0, 0, 640, 360);
  const grad = ctx.createLinearGradient(0, 0, 640, 360);
  grad.addColorStop(0, index % 2 ? "#180b2c" : "#0b1026");
  grad.addColorStop(1, "#07060c");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 640, 360);

  // fake UI chrome
  ctx.strokeStyle = "rgba(215,255,62,0.35)";
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, 604, 324);
  ctx.fillStyle = "rgba(215,255,62,0.8)";
  ctx.font = "700 15px 'Space Mono', monospace";
  ctx.fillText(`● LIVE  /  ${PROJECTS[(index * 3) % PROJECTS.length]}`, 36, 52);
  ctx.fillStyle = "rgba(244,239,228,0.25)";
  ctx.fillText("PITCH ROOM CAM 0" + (index + 1), 36, 82);

  ctx.fillStyle = "#f4efe4";
  ctx.font = "400 86px Anton, Impact, sans-serif";
  ctx.fillText(title, 34, 196);
  ctx.fillStyle = index % 2 ? "#ff2e88" : "#d7ff3e";
  ctx.font = "700 20px 'Space Mono', monospace";
  ctx.fillText(sub, 36, 236);

  // bars
  for (let i = 0; i < 9; i++) {
    const h = 12 + ((i * 37 + index * 19) % 58);
    ctx.fillStyle = i % 3 === 0 ? "rgba(255,46,136,0.75)" : "rgba(71,224,255,0.36)";
    ctx.fillRect(40 + i * 26, 320 - h, 14, h);
  }
  // scanlines
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  for (let y = 0; y < 360; y += 4) ctx.fillRect(0, y, 640, 2);
  const tex = canvasTexture(ctx);
  tex.minFilter = THREE.LinearFilter;
  return tex;
}

export class Arena {
  readonly radius = 30;
  readonly bounds = 24;
  private group = new THREE.Group();
  private debris: { obj: THREE.Object3D; baseY: number; speed: number; phase: number; spin: number }[] = [];
  private screens: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; base: number; phase: number }[] = [];
  private eclipse: THREE.Group;
  private time = 0;
  private rimMat: THREE.MeshBasicMaterial;

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    scene.fog = new THREE.FogExp2(0x080611, 0.017);

    const hemi = new THREE.HemisphereLight(0x9a86ff, 0x0a0614, 0.95);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xc9d6ff, 2.3);
    key.position.set(12, 22, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -28;
    key.shadow.camera.right = 28;
    key.shadow.camera.top = 28;
    key.shadow.camera.bottom = -28;
    key.shadow.camera.far = 70;
    key.shadow.bias = -0.0004;
    scene.add(key);

    const magenta = new THREE.PointLight(COLORS.magenta, 55, 42, 2);
    magenta.position.set(-16, 7, -12);
    scene.add(magenta);
    const cyan = new THREE.PointLight(COLORS.cyan, 42, 38, 2);
    cyan.position.set(15, 6, 10);
    scene.add(cyan);
    const acid = new THREE.PointLight(COLORS.acid, 26, 24, 2);
    acid.position.set(0, 3, 0);
    scene.add(acid);

    // ---------------------------------------------------------------- the floor
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x0c0a18,
      roughness: 0.58,
      metalness: 0.42,
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(34, 96), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    const glowCtx = makeCanvas(512, 512);
    const glowGrad = glowCtx.createRadialGradient(256, 256, 20, 256, 256, 256);
    glowGrad.addColorStop(0, "rgba(255,46,136,0.13)");
    glowGrad.addColorStop(0.42, "rgba(139,92,255,0.07)");
    glowGrad.addColorStop(1, "rgba(0,0,0,0)");
    glowCtx.fillStyle = glowGrad;
    glowCtx.fillRect(0, 0, 512, 512);
    const floorGlow = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 64),
      new THREE.MeshBasicMaterial({
        map: canvasTexture(glowCtx),
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    floorGlow.rotation.x = -Math.PI / 2;
    floorGlow.position.y = 0.015;
    this.group.add(floorGlow);

    const grid = new THREE.Mesh(
      new THREE.PlaneGeometry(66, 66),
      new THREE.MeshBasicMaterial({
        map: gridTexture(),
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = 0.01;
    this.group.add(grid);

    // target rings under the player
    for (const [r, color, w] of [
      [6, COLORS.magenta, 0.035],
      [14, COLORS.cyan, 0.025],
      [23, COLORS.violet, 0.045],
    ] as const) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r, r + w, 128),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.025;
      this.group.add(ring);
    }

    // centre emblem
    const emblem = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 64),
      new THREE.MeshBasicMaterial({ color: 0x120d24, transparent: true, opacity: 0.9 }),
    );
    emblem.rotation.x = -Math.PI / 2;
    emblem.position.y = 0.02;
    this.group.add(emblem);
    const emblemRing = new THREE.Mesh(
      new THREE.RingGeometry(2.6, 2.75, 64),
      new THREE.MeshBasicMaterial({ color: COLORS.acid, transparent: true, opacity: 0.6, side: THREE.DoubleSide }),
    );
    emblemRing.rotation.x = -Math.PI / 2;
    emblemRing.position.y = 0.03;
    this.group.add(emblemRing);

    // ----------------------------------------------------------------- rim glow
    this.rimMat = new THREE.MeshBasicMaterial({ color: COLORS.magenta, transparent: true, opacity: 0.8 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(this.radius + 1, 0.13, 6, 160), this.rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.y = 0.05;
    this.group.add(rim);
    const rim2 = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius + 1.5, 0.04, 6, 160),
      new THREE.MeshBasicMaterial({ color: COLORS.cyan, transparent: true, opacity: 0.6 }),
    );
    rim2.rotation.x = -Math.PI / 2;
    rim2.position.y = 0.06;
    this.group.add(rim2);

    // ------------------------------------------------------------ corporate void
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x0b0917, roughness: 0.8, metalness: 0.3 });
    const stripMat = new THREE.MeshBasicMaterial({ color: COLORS.magenta });
    const wallCount = 11;
    const windowMesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(0.35, 0.5),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, side: THREE.DoubleSide, toneMapped: false }),
      wallCount * 18,
    );
    windowMesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    const winColor = new THREE.Color();
    const localWin = new THREE.Vector3();
    let winIndex = 0;
    for (let i = 0; i < wallCount; i++) {
      const a = (i / wallCount) * TAU;
      const r = 34 + rand(-1.5, 1.5);
      const h = rand(12, 24);
      const w = rand(5, 9);
      const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.4), wallMat);
      slab.position.set(Math.cos(a) * r, h / 2 - 0.2, Math.sin(a) * r);
      slab.rotation.y = -a + Math.PI / 2;
      slab.castShadow = true;
      slab.receiveShadow = true;
      this.group.add(slab);

      const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, 0.08), stripMat);
      strip.position.set(0, h / 2 - 0.4, 0.75);
      slab.add(strip);

      // window lights on the monolith — one instanced draw call for all of them
      slab.updateMatrixWorld(true);
      for (let k = 0; k < 18; k++) {
        localWin.set(rand(-w / 2 + 0.6, w / 2 - 0.6), rand(-h / 2 + 1, h / 2 - 0.8), 0.72);
        slab.localToWorld(localWin);
        dummy.position.copy(localWin);
        dummy.rotation.set(0, -a + Math.PI / 2, 0);
        dummy.updateMatrix();
        windowMesh.setMatrixAt(winIndex, dummy.matrix);
        winColor.setHex(Math.random() > 0.55 ? COLORS.cyan : COLORS.violet).multiplyScalar(rand(0.18, 0.9));
        windowMesh.setColorAt(winIndex, winColor);
        winIndex++;
      }
    }
    windowMesh.instanceMatrix.needsUpdate = true;
    if (windowMesh.instanceColor) windowMesh.instanceColor.needsUpdate = true;
    this.group.add(windowMesh);

    // ---------------------------------------------------------------- billboards
    for (let i = 0; i < 6; i++) {
      const [title, sub] = pick(SLOGANS);
      const mat = new THREE.MeshBasicMaterial({
        map: screenTexture(title, sub, i),
        transparent: true,
        opacity: 0.92,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 4.05), mat);
      const a = (i / 6) * TAU + 0.3;
      const r = 27;
      mesh.position.set(Math.cos(a) * r, rand(4.4, 7.2), Math.sin(a) * r);
      mesh.lookAt(0, mesh.position.y, 0);
      this.group.add(mesh);
      this.screens.push({ mesh, mat, base: mat.opacity, phase: rand(0, TAU) });
    }

    // ---------------------------------------------------------------- the eclipse
    this.eclipse = new THREE.Group();
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(20, 64),
      new THREE.MeshBasicMaterial({ color: 0x05030b, side: THREE.DoubleSide }),
    );
    this.eclipse.add(disc);
    const corona = new THREE.Mesh(
      new THREE.RingGeometry(20, 23.5, 96),
      new THREE.MeshBasicMaterial({
        color: COLORS.magenta,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.eclipse.add(corona);
    const corona2 = new THREE.Mesh(
      new THREE.RingGeometry(23.6, 24.2, 96),
      new THREE.MeshBasicMaterial({
        color: COLORS.cyan,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.eclipse.add(corona2);
    this.eclipse.position.set(-18, 30, -72);
    this.eclipse.rotation.z = 0.18;
    this.group.add(this.eclipse);

    // -------------------------------------------------------------------- sky
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(140, 32, 20),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x04030a) },
          uMid: { value: new THREE.Color(0x1a0e34) },
          uBottom: { value: new THREE.Color(0x2a0a2e) },
        },
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vPos;
          uniform vec3 uTop;
          uniform vec3 uMid;
          uniform vec3 uBottom;
          void main() {
            float h = normalize(vPos).y * 0.5 + 0.5;
            vec3 c = mix(uBottom, uMid, smoothstep(0.35, 0.62, h));
            c = mix(c, uTop, smoothstep(0.6, 1.0, h));
            // stars
            vec3 p = normalize(vPos) * 220.0;
            float s = fract(sin(dot(floor(p.xz), vec2(12.9898, 78.233))) * 43758.5453);
            float star = step(0.9975, s) * smoothstep(0.5, 0.8, h);
            c += vec3(star) * 0.8;
            gl_FragColor = vec4(c, 1.0);
          }`,
      }),
    );
    this.group.add(sky);

    // ------------------------------------------------------------------- debris
    const paperMat = new THREE.MeshStandardMaterial({ color: 0xd8d0bf, roughness: 0.95, side: THREE.DoubleSide });
    for (let i = 0; i < 34; i++) {
      const sheet = new THREE.Mesh(new THREE.PlaneGeometry(rand(0.5, 0.95), rand(0.65, 1.2)), paperMat);
      const a = rand(0, TAU);
      const r = rand(5, 31);
      const y = rand(1.2, 13);
      sheet.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      sheet.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      this.group.add(sheet);
      this.debris.push({ obj: sheet, baseY: y, speed: rand(0.15, 0.5), phase: rand(0, TAU), spin: rand(-0.25, 0.25) });
    }

    for (let i = 0; i < 16; i++) {
      const ball = new THREE.Mesh(
        new THREE.IcosahedronGeometry(rand(0.12, 0.32), 0),
        new THREE.MeshStandardMaterial({ color: rand() > 0.5 ? 0xd8d0bf : 0x9d9485, roughness: 1, flatShading: true }),
      );
      const a = rand(0, TAU);
      const r = rand(3, 29);
      const y = rand(0.4, 6);
      ball.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.group.add(ball);
      this.debris.push({ obj: ball, baseY: y, speed: rand(0.2, 0.6), phase: rand(0, TAU), spin: rand(-0.8, 0.8) });
    }

    // stacks of unsent invoices near the edge
    const invoiceA = new THREE.MeshStandardMaterial({ color: 0xcfc6b4, roughness: 1 });
    const invoiceB = new THREE.MeshStandardMaterial({ color: 0xbab09c, roughness: 1 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU + 0.2;
      const r = rand(25, 28);
      const stack = new THREE.Group();
      const h = randInt(4, 12);
      for (let k = 0; k < h; k++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.09, 2.2), k % 2 ? invoiceA : invoiceB);
        box.position.y = k * 0.095;
        box.rotation.y = rand(-0.12, 0.12);
        box.castShadow = true;
        box.receiveShadow = true;
        stack.add(box);
      }
      stack.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      stack.rotation.y = rand(0, TAU);
      this.group.add(stack);
    }
  }

  randomSpawnPoint(minR = this.bounds + 2, maxR = this.radius - 2): THREE.Vector3 {
    const a = rand(0, TAU);
    const r = rand(minR, maxR);
    return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
  }

  clampToBounds(pos: THREE.Vector3, margin = 0.5): void {
    const limit = this.bounds - margin;
    const d = Math.hypot(pos.x, pos.z);
    if (d > limit) {
      pos.x = (pos.x / d) * limit;
      pos.z = (pos.z / d) * limit;
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const d of this.debris) {
      d.obj.position.y = d.baseY + Math.sin(this.time * d.speed + d.phase) * 0.55;
      d.obj.rotation.y += d.spin * dt;
      d.obj.rotation.x += d.spin * 0.3 * dt;
    }
    for (const s of this.screens) {
      const flicker = 0.92 + Math.sin(this.time * 17 + s.phase) * 0.03 + (Math.random() < 0.004 ? -0.35 : 0);
      s.mat.opacity = Math.max(0.2, s.base * flicker);
    }
    this.eclipse.rotation.z += dt * 0.008;
    this.rimMat.opacity = 0.65 + Math.sin(this.time * 2.2) * 0.18;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.group);
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mats = mesh.material ? (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) : [];
      for (const m of mats) {
        const anyMat = m as THREE.Material & { map?: THREE.Texture };
        anyMat.map?.dispose();
        m.dispose();
      }
    });
  }
}
