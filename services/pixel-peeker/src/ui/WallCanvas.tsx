/**
 * The wall view.
 *
 * SVG rather than canvas: the wall is a few hundred rectangles at most, hit-testing
 * comes free, and the same geometry can be handed straight to the PDF and the
 * exports without a second implementation.
 *
 * View space is millimetres. The SVG viewBox does the zooming, so nothing in here
 * has to think in screen pixels except the wheel handler and the snap tolerance —
 * which is deliberately a screen distance, so a snap feels the same at any zoom.
 *
 * All the placement geometry lives in `domain/snapping`; this file converts pointer
 * events into millimetres, decides which axes are in play, and draws the result.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { chainColour } from '../domain/wiring';
import { cabinetRect, snap, wallBoundsMm, type Rect } from '../domain/wall';
import {
  constrainTo45,
  nextFreeSlot,
  snapRect,
  type Axis,
  type Direction,
  type Guide,
  type SnapResult,
} from '../domain/snapping';

interface View {
  xMm: number;
  yMm: number;
  wMm: number;
}

/** How close, in screen pixels, an alignment has to be before it takes. */
const SNAP_TOLERANCE_PX = 10;
/** Pointer travel, in screen pixels, before a press on a cabinet becomes a drag. */
const DRAG_THRESHOLD_PX = 3;

const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
};

/** A drag in progress. Kept in a ref: it updates faster than React should re-render. */
interface Drag {
  ids: string[];
  idSet: Set<string>;
  /** Where the pointer went down, in wall millimetres. */
  fromXMm: number;
  fromYMm: number;
  /** Bounding box of the moving selection when the drag started. */
  bounds: Rect;
  /** Everything not moving, i.e. what the selection can snap against. */
  statics: Rect[];
  dxMm: number;
  dyMm: number;
  moved: boolean;
}

export function WallCanvas() {
  const project = useStore((s) => s.project);
  const cabinetSpec = useStore((s) => s.cabinetSpec);
  const selected = useStore((s) => s.selectedCabinets);
  const select = useStore((s) => s.select);
  const activeSpecId = useStore((s) => s.activeSpecId);
  const addCabinetAt = useStore((s) => s.addCabinetAt);
  const deleteCabinets = useStore((s) => s.deleteCabinets);
  const moveCabinets = useStore((s) => s.moveCabinets);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);

  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<View>({ xMm: -500, yMm: -500, wMm: 10000 });
  const [tool, setTool] = useState<'select' | 'place'>('select');
  const [showOrder, setShowOrder] = useState(true);
  const [snapping, setSnapping] = useState(true);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /** Live drag offset, mirrored out of `dragRef` purely so the wall re-renders. */
  const [dragOffset, setDragOffset] = useState<{ ids: Set<string>; dxMm: number; dyMm: number } | null>(null);
  /** Where a click would drop a cabinet, in place mode. */
  const [ghost, setGhost] = useState<Rect | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const dragRef = useRef<Drag | null>(null);

  const { aspect, widthPx } = useViewport(svgRef);
  const viewH = view.wMm * aspect;

  const mmPerPx = view.wMm / Math.max(1, widthPx);
  const toleranceMm = mmPerPx * SNAP_TOLERANCE_PX;

  const chainOf = useMemo(() => {
    const m = new Map<string, { colour: string; index: number }>();
    project.chains.forEach((chain, i) => {
      chain.cabinetIds.forEach((id, j) =>
        m.set(id, { colour: chain.colour ?? chainColour(i), index: j + 1 }),
      );
    });
    return m;
  }, [project.chains]);

  const placed = useMemo(
    () =>
      project.cabinets
        .map((inst) => ({ inst, spec: cabinetSpec(inst.specId) }))
        .filter((r): r is { inst: typeof r.inst; spec: NonNullable<typeof r.spec> } => !!r.spec),
    [project.cabinets, cabinetSpec],
  );

  const activeSpec = activeSpecId ? cabinetSpec(activeSpecId) : undefined;

  /**
   * Resolve a candidate position against the wall.
   *
   * With snapping on, alignment against the other cabinets wins and the canvas grid is
   * only the fallback. With it off, the grid is all there is — which is exactly the
   * behaviour this canvas had before snapping existed.
   */
  function resolve(
    candidate: Rect,
    statics: readonly Rect[],
    gridMm: number,
    axes?: readonly Axis[],
  ): SnapResult {
    if (snapping) {
      return snapRect(candidate, statics, { toleranceMm, gridMm, axes });
    }
    const on = (axis: Axis) => !axes || axes.includes(axis);
    return {
      xMm: on('x') ? snap(candidate.xMm, gridMm) : candidate.xMm,
      yMm: on('y') ? snap(candidate.yMm, gridMm) : candidate.yMm,
      guides: [],
    };
  }

  /** Fit the view to the wall, or to the canvas if the wall is empty. */
  function zoomToFit() {
    const b = wallBoundsMm(project, cabinetSpec);
    const box = b ?? {
      xMm: 0,
      yMm: 0,
      widthMm: project.canvas.widthMm,
      heightMm: project.canvas.heightMm,
    };
    const pad = Math.max(box.widthMm, box.heightMm) * 0.08 + 200;
    const wMm = Math.max(box.widthMm + pad * 2, (box.heightMm + pad * 2) / aspect);
    setView({
      xMm: box.xMm - (wMm - box.widthMm) / 2,
      yMm: box.yMm + box.heightMm / 2 - (wMm * aspect) / 2,
      wMm,
    });
  }

  useEffect(() => {
    if (project.cabinets.length && view.wMm === 10000 && view.xMm === -500) zoomToFit();
    // Only on first content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.cabinets.length]);

  /**
   * Extend the wall by one cabinet, flush against the anchor.
   *
   * The spec placed is whatever the library has selected, falling back to the anchor's
   * own model, so tapping arrows continues the run you are already building.
   */
  function growFrom(anchorId: string, direction: Direction) {
    const anchor = placed.find((p) => p.inst.id === anchorId);
    if (!anchor) return;
    const spec = activeSpec ?? anchor.spec;
    const occupied = placed.map((p) => cabinetRect(p.inst, p.spec));
    const slot = nextFreeSlot(cabinetRect(anchor.inst, anchor.spec), direction, spec, occupied);
    if (!slot) return;
    const id = addCabinetAt(spec.id, slot.xMm, slot.yMm, false);
    // Select what we just placed, so the next arrow continues from it.
    if (id) select([id]);
  }

  // Keyboard: delete, nudge or grow, undo/redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected.length) {
        e.preventDefault();
        deleteCabinets(selected);
      } else if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (e.key === 'Escape') {
        select([]);
      } else if (e.key === 'f') {
        zoomToFit();
      } else if (e.key === 's') {
        setSnapping((v) => !v);
      } else if (ARROW_DIRECTIONS[e.key] && selected.length) {
        e.preventDefault();
        const direction = ARROW_DIRECTIONS[e.key];
        if (tool === 'place') {
          // Grow the wall. The anchor is the most recently selected cabinet, which is
          // the one you just placed if you are laying out a run.
          growFrom(selected[selected.length - 1], direction);
        } else {
          const step = e.shiftKey ? 10 : project.canvas.snapMm || 1;
          const dx = direction === 'left' ? -step : direction === 'right' ? step : 0;
          const dy = direction === 'up' ? -step : direction === 'down' ? step : 0;
          moveCabinets(selected, dx, dy);
        }
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // A ghost from place mode has no meaning in select mode, and vice versa.
  useEffect(() => {
    setGhost(null);
    setGuides([]);
  }, [tool]);

  function toMm(e: { clientX: number; clientY: number }) {
    const rect = svgRef.current!.getBoundingClientRect();
    return {
      xMm: view.xMm + ((e.clientX - rect.left) / rect.width) * view.wMm,
      yMm: view.yMm + ((e.clientY - rect.top) / rect.height) * viewH,
    };
  }

  /** Where a cabinet of this spec would land if dropped with the pointer at its centre. */
  function placementAt(p: { xMm: number; yMm: number }, spec: NonNullable<typeof activeSpec>) {
    const candidate: Rect = {
      xMm: p.xMm - spec.widthMm / 2,
      yMm: p.yMm - spec.heightMm / 2,
      widthMm: spec.widthMm,
      heightMm: spec.heightMm,
    };
    // A zero snap grid used to mean "grid of one cabinet"; keep that fallback.
    const gridMm = project.canvas.snapMm || spec.widthMm;
    const statics = placed.map((r) => cabinetRect(r.inst, r.spec));
    return resolve(candidate, statics, gridMm);
  }

  function onWheel(e: React.WheelEvent) {
    const { xMm, yMm } = toMm(e);
    const factor = Math.exp(e.deltaY * 0.0015);
    const wMm = Math.min(200000, Math.max(200, view.wMm * factor));
    // Keep the point under the cursor fixed.
    setView({
      wMm,
      xMm: xMm - (xMm - view.xMm) * (wMm / view.wMm),
      yMm: yMm - (yMm - view.yMm) * (wMm / view.wMm),
    });
  }

  /** Begin dragging a cabinet. Called from the cabinet's own pointer-down handler. */
  function beginDrag(instId: string, e: React.PointerEvent) {
    const alreadySelected = selected.includes(instId);
    const ids = alreadySelected
      ? selected
      : e.shiftKey
        ? [...new Set([...selected, instId])]
        : [instId];
    if (!alreadySelected) select([instId], e.shiftKey);

    const idSet = new Set(ids);
    const moving = placed.filter((p) => idSet.has(p.inst.id));
    if (!moving.length) return;

    const rects = moving.map((p) => cabinetRect(p.inst, p.spec));
    const minX = Math.min(...rects.map((r) => r.xMm));
    const minY = Math.min(...rects.map((r) => r.yMm));
    const maxX = Math.max(...rects.map((r) => r.xMm + r.widthMm));
    const maxY = Math.max(...rects.map((r) => r.yMm + r.heightMm));

    const p = toMm(e);
    dragRef.current = {
      ids,
      idSet,
      fromXMm: p.xMm,
      fromYMm: p.yMm,
      bounds: { xMm: minX, yMm: minY, widthMm: maxX - minX, heightMm: maxY - minY },
      statics: placed
        .filter((r) => !idSet.has(r.inst.id))
        .map((r) => cabinetRect(r.inst, r.spec)),
      dxMm: 0,
      dyMm: 0,
      moved: false,
    };
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button === 1 || e.altKey || (e.button === 0 && e.shiftKey && e.metaKey)) {
      panRef.current = { x: e.clientX, y: e.clientY, vx: view.xMm, vy: view.yMm };
      (e.target as Element).setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const p = toMm(e);
    if (tool === 'place' && activeSpec) {
      const at = placementAt(p, activeSpec);
      const id = addCabinetAt(activeSpec.id, at.xMm, at.yMm, false);
      // Selecting it is what makes arrow-key growth continue from here.
      if (id) select([id]);
      return;
    }
    setMarquee({ x0: p.xMm, y0: p.yMm, x1: p.xMm, y1: p.yMm });
    (e.target as Element).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (panRef.current) {
      const rect = svgRef.current!.getBoundingClientRect();
      const dx = ((e.clientX - panRef.current.x) / rect.width) * view.wMm;
      const dy = ((e.clientY - panRef.current.y) / rect.height) * viewH;
      setView((v) => ({ ...v, xMm: panRef.current!.vx - dx, yMm: panRef.current!.vy - dy }));
      return;
    }

    const drag = dragRef.current;
    if (drag) {
      const p = toMm(e);
      let dxMm = p.xMm - drag.fromXMm;
      let dyMm = p.yMm - drag.fromYMm;
      if (!drag.moved && Math.hypot(dxMm, dyMm) < mmPerPx * DRAG_THRESHOLD_PX) return;
      drag.moved = true;

      // Shift locks the drag to 45°. Alignment is then restricted to the axis the
      // movement is free on, because an alignment across the lock would break it — and
      // on a diagonal there is no free axis, so alignment is off entirely. The grid is
      // applied along the lock instead, which is what keeps a diagonal on whole
      // millimetres without bending it off 45°.
      let axes: readonly Axis[] | undefined;
      if (e.shiftKey) {
        const c = constrainTo45(dxMm, dyMm, project.canvas.snapMm);
        dxMm = c.dxMm;
        dyMm = c.dyMm;
        axes = c.axis ? [c.axis] : [];
      }

      const candidate: Rect = {
        ...drag.bounds,
        xMm: drag.bounds.xMm + dxMm,
        yMm: drag.bounds.yMm + dyMm,
      };
      const settled = resolve(candidate, drag.statics, project.canvas.snapMm, axes);
      drag.dxMm = settled.xMm - drag.bounds.xMm;
      drag.dyMm = settled.yMm - drag.bounds.yMm;
      setDragOffset({ ids: drag.idSet, dxMm: drag.dxMm, dyMm: drag.dyMm });
      setGuides(settled.guides);
      return;
    }

    if (tool === 'place' && activeSpec) {
      const at = placementAt(toMm(e), activeSpec);
      setGhost({
        xMm: at.xMm,
        yMm: at.yMm,
        widthMm: activeSpec.widthMm,
        heightMm: activeSpec.heightMm,
      });
      setGuides(at.guides);
      return;
    }

    if (marquee) {
      const p = toMm(e);
      setMarquee((m) => (m ? { ...m, x1: p.xMm, y1: p.yMm } : null));
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    panRef.current = null;

    const drag = dragRef.current;
    if (drag) {
      dragRef.current = null;
      setDragOffset(null);
      setGuides([]);
      // One commit for the whole drag, so it is a single undo step. The position has
      // already been resolved, hence no second grid rounding.
      if (drag.moved && (drag.dxMm !== 0 || drag.dyMm !== 0)) {
        moveCabinets(drag.ids, drag.dxMm, drag.dyMm, false);
      }
      return;
    }

    if (!marquee) return;
    const x0 = Math.min(marquee.x0, marquee.x1);
    const x1 = Math.max(marquee.x0, marquee.x1);
    const y0 = Math.min(marquee.y0, marquee.y1);
    const y1 = Math.max(marquee.y0, marquee.y1);
    setMarquee(null);

    // A click rather than a drag clears the selection.
    if (x1 - x0 < 20 && y1 - y0 < 20) {
      if (!e.shiftKey) select([]);
      return;
    }
    const hit = placed
      .filter(
        ({ inst, spec }) =>
          inst.xMm < x1 && inst.xMm + spec.widthMm > x0 &&
          inst.yMm < y1 && inst.yMm + spec.heightMm > y0,
      )
      .map(({ inst }) => inst.id);
    select(hit, e.shiftKey);
  }

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const guidePadMm = view.wMm / 60;

  return (
    <div className="stage">
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        viewBox={`${view.xMm} ${view.yMm} ${view.wMm} ${viewH}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setGhost(null);
          if (!dragRef.current) setGuides([]);
        }}
        style={{ cursor: tool === 'place' ? 'crosshair' : 'default', display: 'block' }}
      >
        {/* design envelope */}
        <rect
          x={0}
          y={0}
          width={project.canvas.widthMm}
          height={project.canvas.heightMm}
          fill="none"
          stroke="#3a4552"
          strokeWidth={view.wMm / 600}
          strokeDasharray={`${view.wMm / 90} ${view.wMm / 140}`}
        />

        {placed.map(({ inst, spec }) => {
          const chain = chainOf.get(inst.id);
          const isSel = selectedSet.has(inst.id);
          const moving = dragOffset?.ids.has(inst.id) ? dragOffset : null;
          const xMm = inst.xMm + (moving?.dxMm ?? 0);
          const yMm = inst.yMm + (moving?.dyMm ?? 0);
          return (
            <g
              key={inst.id}
              onPointerDown={(e) => {
                if (tool === 'place') return;
                e.stopPropagation();
                beginDrag(inst.id, e);
              }}
              style={{ cursor: tool === 'place' ? 'crosshair' : 'move' }}
            >
              <rect
                x={xMm}
                y={yMm}
                width={spec.widthMm}
                height={spec.heightMm}
                fill={chain ? chain.colour : '#39414c'}
                fillOpacity={chain ? 0.85 : 0.6}
                stroke={isSel ? '#ffffff' : '#0e1116'}
                strokeWidth={isSel ? view.wMm / 400 : view.wMm / 1400}
              />
              {showOrder && chain && spec.widthMm / view.wMm > 0.022 && (
                <text
                  x={xMm + spec.widthMm / 2}
                  y={yMm + spec.heightMm / 2}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill="#0e1116"
                  fontWeight="700"
                  fontSize={spec.heightMm * 0.3}
                  pointerEvents="none"
                >
                  {chain.index}
                </text>
              )}
            </g>
          );
        })}

        {/* chain routes */}
        {showOrder &&
          project.chains.map((chain, i) => {
            const pts = chain.cabinetIds
              .map((id) => placed.find((p) => p.inst.id === id))
              .filter(Boolean)
              .map((p) => `${p!.inst.xMm + p!.spec.widthMm / 2},${p!.inst.yMm + p!.spec.heightMm / 2}`);
            if (pts.length < 2) return null;
            return (
              <polyline
                key={chain.id}
                points={pts.join(' ')}
                fill="none"
                stroke={chain.colour ?? chainColour(i)}
                strokeWidth={view.wMm / 500}
                strokeOpacity={0.9}
                strokeLinejoin="round"
                strokeLinecap="round"
                pointerEvents="none"
              />
            );
          })}

        {/* where a click would drop the next cabinet */}
        {ghost && (
          <rect
            x={ghost.xMm}
            y={ghost.yMm}
            width={ghost.widthMm}
            height={ghost.heightMm}
            fill="#2f9ee0"
            fillOpacity={0.18}
            stroke="#2f9ee0"
            strokeWidth={view.wMm / 700}
            strokeDasharray={`${view.wMm / 150} ${view.wMm / 220}`}
            pointerEvents="none"
          />
        )}

        {/* alignment guides — only drawn for an axis that actually snapped */}
        {guides.map((g) => (
          <line
            key={`${g.axis}-${g.posMm}`}
            x1={g.axis === 'x' ? g.posMm : g.fromMm - guidePadMm}
            x2={g.axis === 'x' ? g.posMm : g.toMm + guidePadMm}
            y1={g.axis === 'x' ? g.fromMm - guidePadMm : g.posMm}
            y2={g.axis === 'x' ? g.toMm + guidePadMm : g.posMm}
            stroke="#f0c674"
            strokeWidth={view.wMm / 900}
            strokeOpacity={0.95}
            pointerEvents="none"
          />
        ))}

        {marquee && (
          <rect
            x={Math.min(marquee.x0, marquee.x1)}
            y={Math.min(marquee.y0, marquee.y1)}
            width={Math.abs(marquee.x1 - marquee.x0)}
            height={Math.abs(marquee.y1 - marquee.y0)}
            fill="#2f9ee022"
            stroke="#2f9ee0"
            strokeWidth={view.wMm / 800}
          />
        )}
      </svg>

      <div className="hint">
        {tool === 'place'
          ? 'Click to place · Arrows extend the wall from the selected cabinet'
          : 'Drag to move · Shift constrains to 45° · Arrows nudge · Alt-drag to pan'}
        {selected.length > 0 && ` · ${selected.length} selected`}
      </div>

      <div className="overlay">
        <button
          className={tool === 'select' ? 'primary' : ''}
          onClick={() => setTool('select')}
        >
          Select
        </button>
        <button
          className={tool === 'place' ? 'primary' : ''}
          onClick={() => setTool('place')}
          disabled={!activeSpecId}
        >
          Place
        </button>
        <button onClick={zoomToFit}>Fit</button>
        <button
          className={snapping ? 'primary' : ''}
          onClick={() => setSnapping((v) => !v)}
          title="Align new and dragged cabinets with the ones already on the wall (S)"
        >
          Snap
        </button>
        <button
          className={showOrder ? 'primary' : ''}
          onClick={() => setShowOrder((v) => !v)}
        >
          Wiring
        </button>
        <button
          className="danger"
          disabled={!selected.length}
          onClick={() => deleteCabinets(selected)}
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/**
 * Size of the SVG element: the height/width ratio, so the viewBox stays square in
 * millimetres, and the width in pixels, so a screen distance can be turned into one.
 */
function useViewport(ref: React.RefObject<SVGSVGElement | null>) {
  const [size, setSize] = useState({ aspect: 0.6, widthPx: 1000 });
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const update = () => {
      const r = el.getBoundingClientRect();
      if (r.width > 0) setSize({ aspect: r.height / r.width, widthPx: r.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}
