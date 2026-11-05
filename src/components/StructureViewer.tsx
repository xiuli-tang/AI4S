import React, { useEffect, useRef, useState } from "react";
import type { CrystalStructure, DisplayAtom } from "../structures/types";
import { cellEdges } from "../structures/geometry";
import { useI18n } from "../i18n";

const colors: Record<string, string> = {
  H: "#d8e5ec", C: "#52687b", N: "#477dce", O: "#eb6477", F: "#77c9a1",
  Li: "#9c88df", Na: "#9c88df", Cl: "#77bd74", S: "#dfbc53", P: "#ed9c61",
  Ti: "#8d9eb5", Sr: "#75bcb3", Ca: "#72b393", Fe: "#d28c61", Co: "#7198d4",
  Ni: "#87b191", Cu: "#c28c65", Sc: "#91c4d2", Er: "#d194c5", Ba: "#80af9e",
};
export const elementColor = (symbol: string) => colors[symbol] ?? `hsl(${[...symbol].reduce((n, c) => n + c.charCodeAt(0) * 23, 0) % 360},45%,63%)`;

interface Props {
  structure: CrystalStructure;
  atoms: DisplayAtom[];
  repeats: number;
  showCell: boolean;
  showNeighbors: boolean;
  cutoff: number;
  selected: number[];
  active: boolean;
  onSelect(index: number): void;
}

/** Rendering only: this component never guesses a structure or changes its scientific data. */
export default function StructureViewer(props: Props) {
  const { lang, t } = useI18n();
  const host = useRef<HTMLDivElement>(null);
  const runtime = useRef<any>(null);
  const selectionCallback = useRef(props.onSelect);
  selectionCallback.current = props.onSelect;
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const instructions = t("拖动旋转 · 滚轮缩放 · 右键平移 · 点击原子选择位点", "Drag to rotate · Scroll to zoom · Right-drag to pan · Select atoms by clicking");
  useEffect(() => { host.current?.querySelector("canvas")?.setAttribute("aria-label", instructions); }, [lang, ready]);

  useEffect(() => {
    let cancelled = false;
    const disposers: (() => void)[] = [];
    const cleanup = () => {
      for (const dispose of disposers.splice(0).reverse()) {
        try { dispose(); } catch { /* Continue releasing the remaining resources. */ }
      }
    };
    void (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
        if (cancelled || !host.current) return;
        const container = host.current;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
        disposers.push(() => {
          renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0xeff5f8);
        renderer.domElement.setAttribute("aria-label", instructions);
        renderer.domElement.setAttribute("role", "img");
        container.appendChild(renderer.domElement);
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 2.1));
        const key = new THREE.DirectionalLight(0xffffff, 3);
        key.position.set(8, 12, 15); scene.add(key);
        const fill = new THREE.DirectionalLight(0xc4dfea, 1.8);
        fill.position.set(-10, -4, -2); scene.add(fill);
        const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 100000);
        const controls = new OrbitControls(camera, renderer.domElement);
        disposers.push(() => controls.dispose());
        controls.enableDamping = false;
        const content = new THREE.Group(); scene.add(content);
        const render = () => renderer.render(scene, camera);
        const resize = () => {
          const width = container.clientWidth, height = container.clientHeight;
          if (!width || !height) return;
          renderer.setSize(width, height);
          camera.aspect = width / height;
          camera.updateProjectionMatrix(); render();
        };
        const observer = new ResizeObserver(resize);
        disposers.push(() => observer.disconnect());
        observer.observe(container);
        controls.addEventListener("change", render);
        disposers.push(() => controls.removeEventListener("change", render));
        const raycaster = new THREE.Raycaster();
        let down: { x: number; y: number } | null = null;
        const pointerDown = (event: PointerEvent) => { down = { x: event.clientX, y: event.clientY }; };
        const pointerUp = (event: PointerEvent) => {
          if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
          down = null;
          const mesh = runtime.current?.mesh;
          if (!mesh) return;
          const rect = renderer.domElement.getBoundingClientRect();
          raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1,
            -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
          const hit = raycaster.intersectObject(mesh)[0];
          if (hit?.instanceId !== undefined) selectionCallback.current(hit.instanceId);
        };
        renderer.domElement.addEventListener("pointerdown", pointerDown);
        renderer.domElement.addEventListener("pointerup", pointerUp);
        disposers.push(() => {
          renderer.domElement.removeEventListener("pointerdown", pointerDown);
          renderer.domElement.removeEventListener("pointerup", pointerUp);
        });
        const disposeContent = () => {
          content.traverse((object: any) => {
            if (object.isInstancedMesh) object.dispose();
            object.geometry?.dispose();
            if (Array.isArray(object.material)) object.material.forEach((m: any) => m.dispose());
            else object.material?.dispose();
          });
          content.clear();
        };
        disposers.push(disposeContent);
        runtime.current = { THREE, scene, renderer, camera, controls, content, render, resize, disposeContent, mesh: null, fit: () => {} };
        disposers.push(() => { runtime.current = null; });
        resize(); setReady(true);
      } catch {
        cleanup();
        if (!cancelled) setError("无法创建 WebGL 3D 视图。请启用浏览器硬件加速；结构信息与原子表仍可查看。");
      }
    })();
    return () => { cancelled = true; cleanup(); };
  }, []);

  useEffect(() => {
    const rt = runtime.current;
    if (!ready || !rt) return;
    const { THREE, content, camera, controls } = rt;
    rt.disposeContent();
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 12),
      new THREE.MeshStandardMaterial({ roughness: 0.38, metalness: 0.1 }), props.atoms.length);
    const transform = new THREE.Object3D();
    props.atoms.forEach((atom, index) => {
      transform.position.set(...atom.position);
      const radius = atom.element === "H" ? 0.19 : atom.element === "O" ? 0.31 : 0.42;
      transform.scale.setScalar(radius); transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix); mesh.setColorAt(index, new THREE.Color(elementColor(atom.element)));
    });
    mesh.instanceMatrix.needsUpdate = true; content.add(mesh); rt.mesh = mesh;
    const line = (positions: number[], color: number, opacity = 1) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      content.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity })));
    };
    if (props.showCell) line(cellEdges(props.structure.lattice, props.repeats).flat(2), 0x7998ab);
    if (props.showNeighbors && props.atoms.length <= 1200) {
      const positions: number[] = [];
      for (let i = 0; i < props.atoms.length; i++) for (let j = i + 1; j < props.atoms.length; j++) {
        const a = props.atoms[i].position, b = props.atoms[j].position;
        const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        if (d > 0.15 && d <= props.cutoff && positions.length < 48000) positions.push(...a, ...b);
      }
      line(positions, 0x819ba9, 0.58);
    }
    const bounds = new THREE.Box3().setFromObject(content);
    const center = bounds.getCenter(new THREE.Vector3());
    const size = Math.max(bounds.getSize(new THREE.Vector3()).length(), 1);
    rt.fit = () => {
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(1, 0.7, 1.2).normalize().multiplyScalar(size * 1.6));
      camera.near = Math.max(size / 10000, 0.001); camera.far = size * 1000;
      camera.updateProjectionMatrix(); controls.update(); rt.resize();
    };
    rt.fit();
  }, [ready, props.structure, props.atoms, props.repeats, props.showCell, props.showNeighbors, props.cutoff]);

  useEffect(() => {
    const rt = runtime.current;
    if (!ready || !rt?.mesh) return;
    props.atoms.forEach((atom, index) => rt.mesh.setColorAt(index,
      new rt.THREE.Color(props.selected.includes(index) ? "#f1b451" : elementColor(atom.element))));
    if (rt.mesh.instanceColor) rt.mesh.instanceColor.needsUpdate = true;
    rt.render();
  }, [ready, props.atoms, props.selected, props.showCell, props.showNeighbors, props.cutoff]);

  useEffect(() => { if (props.active && ready) runtime.current?.resize(); }, [props.active, ready]);
  const zoom = (factor: number) => {
    const rt = runtime.current; if (!rt) return;
    rt.camera.position.sub(rt.controls.target).multiplyScalar(factor).add(rt.controls.target);
    rt.controls.update(); rt.render();
  };

  return <div className="structure-stage">
    <div className="structure-canvas" ref={host} />
    {!ready && !error && <div className="structure-stage-message" role="status">{t("正在准备 3D 查看器…", "Preparing the 3D viewer…")}</div>}
    {error && <div className="structure-stage-message" role="alert">{t("无法创建 WebGL 3D 视图。请启用浏览器硬件加速；结构信息与原子表仍可查看。", "The 3D view could not start. Enable browser hardware acceleration; structure details and the atom table remain available.")}</div>}
    <div className="structure-stage-toolbar">
      <button type="button" onClick={() => runtime.current?.fit()} disabled={!ready}>{t("复位视角", "Reset view")}</button>
      <button type="button" aria-label={t("放大结构", "Zoom in")} onClick={() => zoom(0.8)} disabled={!ready}>＋</button>
      <button type="button" aria-label={t("缩小结构", "Zoom out")} onClick={() => zoom(1.25)} disabled={!ready}>−</button>
    </div>
    <div className="structure-stage-caption">{instructions}</div>
  </div>;
}
