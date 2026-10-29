import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uRage: { value: 0 },
    uDamage: { value: 0 },
    uAberration: { value: 0.0016 },
    uGrain: { value: 0.055 },
    uVignette: { value: 1.0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uRage;
    uniform float uDamage;
    uniform float uAberration;
    uniform float uGrain;
    uniform float uVignette;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 center = uv - 0.5;
      float dist = length(center);
      float ab = uAberration + uRage * 0.006 + uDamage * 0.004;
      vec2 offset = normalize(center + 0.0001) * ab * dist;

      float r = texture2D(tDiffuse, uv + offset).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - offset).b;
      vec3 color = vec3(r, g, b);

      // subtle scanlines
      color *= 0.985 + 0.015 * sin(uv.y * 900.0);

      // grain
      float grain = hash(uv * vec2(1920.0, 1080.0) + uTime * 60.0) - 0.5;
      color += grain * uGrain * (0.4 + uRage * 1.4);

      // vignette
      float vignette = smoothstep(0.82, 0.22, dist * uVignette);
      color *= mix(1.0, vignette, 0.85);

      // rage: magenta wash + pulse at the edges
      float pulse = 0.55 + 0.45 * sin(uTime * 6.0);
      color = mix(color, color * vec3(1.5, 0.55, 1.15), uRage * (0.25 + dist * 0.85));
      color += vec3(1.0, 0.1, 0.45) * uRage * dist * 0.18 * pulse;

      // damage: red edge bleed
      color = mix(color, vec3(0.85, 0.04, 0.08), uDamage * smoothstep(0.18, 0.72, dist) * 0.75);

      gl_FragColor = vec4(color, 1.0);
    }`,
};

export class Post {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  grade: ShaderPass;
  low = false;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.46, 0.42, 0.84);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  setLow(low: boolean): void {
    this.low = low;
    this.bloom.enabled = !low;
    this.composer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.6));
    this.composer.setSize(window.innerWidth, window.innerHeight);
  }

  render(dt: number, rage: number, damage: number, time: number): void {
    const u = this.grade.uniforms;
    u.uRage!.value = rage;
    u.uDamage!.value = damage;
    u.uTime!.value = time;
    if (this.low) {
      this.renderer.render(this.scene, this.camera);
    } else {
      this.composer.render(dt);
    }
  }
}
