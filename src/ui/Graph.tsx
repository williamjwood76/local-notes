import { useEffect, useRef } from "react";
import { activePath, getState, openNote, setGraphMode, setGraphTag, toggleOrphans, useApp } from "../store";
import { isImagePath, makeResolver } from "../resolve";

type SimNode = { id: string; title: string; x: number; y: number; vx: number; vy: number };
type SimEdge = { source: number; target: number };

function graphModel() {
  const current = getState();
  const tag = current.graphTag.trim().toLowerCase();
  let notes = [...current.notes.values()].filter(
    (note) => !tag || note.tags.some((item) => item.toLowerCase() === tag || item.toLowerCase().startsWith(`${tag}/`)),
  );
  const resolve = makeResolver(current.notes.values());
  const ids = new Set(notes.map((note) => note.path));
  const seen = new Set<string>();
  const pairs: { source: string; target: string }[] = [];
  for (const note of current.notes.values()) {
    if (!ids.has(note.path) && !(current.graphMode === "local" && note.path === activePath(current))) continue;
    for (const link of note.links) {
      if (isImagePath(link.target)) continue;
      const hit = resolve(link.target);
      if (hit.status !== "ok" || hit.path === note.path) continue;
      const key = note.path < hit.path ? `${note.path}\0${hit.path}` : `${hit.path}\0${note.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ source: note.path, target: hit.path });
    }
  }
  if (current.graphMode === "local") {
    const center = activePath(current);
    if (!center || !current.notes.has(center)) return { notes: [], pairs: [] };
    const keep = new Set<string>([center]);
    for (const pair of pairs) {
      if (pair.source === center) keep.add(pair.target);
      if (pair.target === center) keep.add(pair.source);
    }
    notes = [...current.notes.values()].filter((note) => keep.has(note.path) && (!tag || keep.has(note.path)));
    if (tag) {
      notes = notes.filter(
        (note) =>
          note.path === center ||
          note.tags.some((item) => item.toLowerCase() === tag || item.toLowerCase().startsWith(`${tag}/`)),
      );
    }
    const keepIds = new Set(notes.map((note) => note.path));
    return { notes, pairs: pairs.filter((pair) => keepIds.has(pair.source) && keepIds.has(pair.target)) };
  }
  if (!current.graphOrphans) {
    const linked = new Set(pairs.flatMap((pair) => [pair.source, pair.target]));
    notes = notes.filter((note) => linked.has(note.path));
  }
  const keepIds = new Set(notes.map((note) => note.path));
  return { notes, pairs: pairs.filter((pair) => keepIds.has(pair.source) && keepIds.has(pair.target)) };
}

export function GraphView() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const version = useApp((state) => state.notesVersion);
  const mode = useApp((state) => state.graphMode);
  const orphans = useApp((state) => state.graphOrphans);
  const tag = useApp((state) => state.graphTag);
  const center = useApp(activePath);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const model = graphModel();
    const limited = model.notes.slice(0, 500);
    const allowed = new Set(limited.map((note) => note.path));
    const index = new Map(limited.map((note, position) => [note.path, position]));
    const nodes: SimNode[] = limited.map((note, position) => {
      const angle = (Math.PI * 2 * position) / Math.max(1, limited.length);
      const radius = 40 + limited.length * 1.4;
      return {
        id: note.path,
        title: note.title,
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0,
        vy: 0,
      };
    });
    const edges: SimEdge[] = model.pairs.flatMap((pair) => {
      const source = index.get(pair.source);
      const target = index.get(pair.target);
      if (source === undefined || target === undefined || !allowed.has(pair.source)) return [];
      return [{ source, target }];
    });
    const context = canvas.getContext("2d");
    if (!context) return;
    let frame = 0;
    let running = true;
    let drag: { id: number; dx: number; dy: number; moved: boolean } | null = null;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * ratio));
      canvas.height = Math.max(1, Math.floor(rect.height * ratio));
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const pointOf = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
    };

    const hit = (x: number, y: number) => {
      let found = -1;
      let best = 18;
      for (let indexNode = 0; indexNode < nodes.length; indexNode++) {
        const node = nodes[indexNode];
        const distance = Math.hypot(node.x - x, node.y - y);
        if (distance < best) {
          best = distance;
          found = indexNode;
        }
      }
      return found;
    };

    const draw = () => {
      const rect = canvas.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      context.save();
      context.translate(rect.width / 2, rect.height / 2);
      context.strokeStyle = "rgba(215, 161, 90, 0.35)";
      context.lineWidth = 1;
      for (const edge of edges) {
        const a = nodes[edge.source];
        const b = nodes[edge.target];
        context.beginPath();
        context.moveTo(a.x, a.y);
        context.lineTo(b.x, b.y);
        context.stroke();
      }
      for (const node of nodes) {
        const active = node.id === center;
        context.beginPath();
        context.fillStyle = active ? "#d7a15a" : "#e7e3d8";
        context.arc(node.x, node.y, active ? 7 : 4.5, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = "#b7b1a4";
        context.font = "12px ui-sans-serif, system-ui, sans-serif";
        context.fillText(node.title, node.x + 8, node.y + 4);
      }
      context.restore();
    };

    const step = () => {
      if (drag) return;
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          const dist = Math.max(12, Math.hypot(dx, dy));
          const force = 900 / (dist * dist);
          dx /= dist;
          dy /= dist;
          a.vx -= dx * force;
          a.vy -= dy * force;
          b.vx += dx * force;
          b.vy += dy * force;
        }
      }
      for (const edge of edges) {
        const a = nodes[edge.source];
        const b = nodes[edge.target];
        a.vx += (b.x - a.x) * 0.02;
        a.vy += (b.y - a.y) * 0.02;
        b.vx -= (b.x - a.x) * 0.02;
        b.vy -= (b.y - a.y) * 0.02;
      }
      for (const node of nodes) {
        node.vx -= node.x * 0.01;
        node.vy -= node.y * 0.01;
        node.vx *= 0.82;
        node.vy *= 0.82;
        node.x += node.vx;
        node.y += node.vy;
      }
    };

    const loop = () => {
      if (!running) return;
      if (frame < 280) step();
      frame += 1;
      draw();
      if (frame < 280 || drag) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    const onDown = (event: PointerEvent) => {
      const point = pointOf(event);
      const id = hit(point.x, point.y);
      if (id < 0) return;
      drag = { id, dx: nodes[id].x - point.x, dy: nodes[id].y - point.y, moved: false };
      canvas.setPointerCapture(event.pointerId);
    };
    const onMove = (event: PointerEvent) => {
      if (!drag) return;
      const point = pointOf(event);
      const node = nodes[drag.id];
      const nextX = point.x + drag.dx;
      const nextY = point.y + drag.dy;
      if (Math.hypot(nextX - node.x, nextY - node.y) > 3) drag.moved = true;
      node.x = nextX;
      node.y = nextY;
      node.vx = 0;
      node.vy = 0;
      draw();
    };
    const onUp = () => {
      if (drag && !drag.moved) void openNote(nodes[drag.id].id);
      drag = null;
    };
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);

    return () => {
      running = false;
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [version, mode, orphans, tag, center]);

  const count = getState().notes.size;
  return (
    <div className="graph-view">
      <div className="graph-toolbar">
        <button className={mode === "global" ? "on" : ""} onClick={() => setGraphMode("global")} type="button">
          Full vault
        </button>
        <button className={mode === "local" ? "on" : ""} onClick={() => setGraphMode("local")} type="button">
          Neighbors
        </button>
        <label>
          <input checked={orphans} onChange={() => toggleOrphans()} type="checkbox" />
          Orphans
        </label>
        <input
          aria-label="Filter graph by tag"
          onChange={(event) => setGraphTag(event.target.value)}
          placeholder="Tag filter"
          value={tag}
        />
        {count > 500 && mode === "global" ? <span>Showing 500 of {count} notes</span> : null}
      </div>
      <canvas ref={canvasRef} />
      {mode === "local" && !center ? <p className="graph-empty">Open a note to see its neighbors.</p> : null}
    </div>
  );
}
