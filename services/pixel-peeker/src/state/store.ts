/**
 * Pixel Peeker — application state.
 *
 * One zustand store holds the whole project document plus UI selection. The project
 * document is the only thing that gets saved, exported or undone; selection and view
 * state deliberately sit outside the undo stack so that clicking around does not
 * bury a real edit.
 */

import { useMemo } from 'react';
import { create } from 'zustand';
import { CABINET_LIBRARY } from '../data/cabinets';
import { PROCESSOR_LIBRARY, RECEIVER_LIBRARY } from '../data/processors';
import type {
  CabinetSpec,
  PowerPlan,
  Project,
  ProcessorSpec,
  ReceivingCardSpec,
  SignalFormat,
} from '../domain/types';
import { DEFAULT_POWER_PLAN } from '../domain/power-line';
import { buildGrid, snap, validateWall, wallStats } from '../domain/wall';
import type { Issue } from '../domain/wall';
import {
  autoWire,
  computeLoads,
  validateWiring,
  type AutoWireOptions,
  type ProcessorLoad,
} from '../domain/wiring';

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${idCounter++}`;

export function emptyProject(): Project {
  return {
    schema: 'pixel-peeker/1',
    name: 'Untitled wall',
    canvas: { name: 'Main screen', widthMm: 8000, heightMm: 4500, snapMm: 1 },
    signal: { bitDepth: 8, frameRateHz: 60, ledRefreshHz: 3840 },
    cabinets: [],
    processors: [],
    chains: [],
    customCabinets: [],
    customProcessors: [],
    customReceivers: [],
  };
}

interface Derived {
  stats: ReturnType<typeof wallStats>;
  loads: ProcessorLoad[];
  issues: Issue[];
}

interface State {
  project: Project;
  selectedCabinets: string[];
  selectedChain: string | null;
  /** Spec chosen in the library, used by click-to-place. */
  activeSpecId: string | null;
  past: Project[];
  future: Project[];

  // derived, recomputed on every project change
  derived: Derived;

  // --- library access (built-in merged with project-authored specs)
  cabinetSpecs: () => CabinetSpec[];
  processorSpecs: () => ProcessorSpec[];
  receiverSpecs: () => ReceivingCardSpec[];
  cabinetSpec: (id: string) => CabinetSpec | undefined;
  processorSpec: (id: string) => ProcessorSpec | undefined;
  receiverSpec: (id: string) => ReceivingCardSpec | undefined;

  // --- mutations
  commit: (fn: (draft: Project) => void) => void;
  undo: () => void;
  redo: () => void;
  loadProject: (p: Project) => void;

  setSignal: (s: Partial<SignalFormat>) => void;
  setCanvas: (c: Partial<Project['canvas']>) => void;
  setMeta: (m: Partial<Pick<Project, 'name' | 'client' | 'venue' | 'designer' | 'notes'>>) => void;
  /** Part of the document, so it is saved, undone and printed in the PDF with the wall. */
  setPower: (p: Partial<PowerPlan>) => void;

  addGrid: (specId: string, cols: number, rows: number, xMm?: number, yMm?: number) => void;
  /**
   * Place one cabinet and return its id, or null if the spec is unknown.
   *
   * `snapToGrid` is the legacy behaviour — round to the canvas grid on the way in.
   * Pass false when the position has already been resolved against the other cabinets
   * (see `domain/snapping`), because re-rounding it would undo the alignment.
   */
  addCabinetAt: (specId: string, xMm: number, yMm: number, snapToGrid?: boolean) => string | null;
  moveCabinets: (ids: string[], dxMm: number, dyMm: number, snapToGrid?: boolean) => void;
  deleteCabinets: (ids: string[]) => void;
  fillCanvas: (specId: string) => void;

  addProcessor: (specId: string) => void;
  removeProcessor: (id: string) => void;
  renameProcessor: (id: string, name: string) => void;

  runAutoWire: (options: AutoWireOptions) => string[];
  clearWiring: () => void;
  setChainOrder: (chainId: string, cabinetIds: string[]) => void;
  patchCabinetsTo: (processorId: string, portId: string, cabinetIds: string[]) => void;

  addCustomCabinet: (spec: CabinetSpec) => void;
  addCustomProcessor: (spec: ProcessorSpec) => void;

  // --- selection
  select: (ids: string[], additive?: boolean) => void;
  selectChain: (id: string | null) => void;
  setActiveSpec: (id: string | null) => void;
}

function derive(
  project: Project,
  cabinetSpec: (id: string) => CabinetSpec | undefined,
  processorSpec: (id: string) => ProcessorSpec | undefined,
): Derived {
  const stats = wallStats(project, cabinetSpec);
  const loads = computeLoads(project, cabinetSpec, processorSpec);
  const issues = [
    ...validateWall(project, cabinetSpec),
    ...validateWiring(project, loads, cabinetSpec),
  ];
  return { stats, loads, issues };
}

const HISTORY_LIMIT = 50;

export const useStore = create<State>((set, get) => {
  const cabinetSpec = (id: string) =>
    get().project.customCabinets.find((c) => c.id === id) ??
    CABINET_LIBRARY.find((c) => c.id === id);
  const processorSpec = (id: string) =>
    get().project.customProcessors.find((p) => p.id === id) ??
    PROCESSOR_LIBRARY.find((p) => p.id === id);
  const receiverSpec = (id: string) =>
    get().project.customReceivers.find((r) => r.id === id) ??
    RECEIVER_LIBRARY.find((r) => r.id === id);

  const initial = emptyProject();

  /** Apply a mutation, push the previous document onto the undo stack, re-derive. */
  const commit: State['commit'] = (fn) => {
    const { project, past } = get();
    const draft: Project = structuredClone(project);
    fn(draft);
    set({
      project: draft,
      past: [...past, project].slice(-HISTORY_LIMIT),
      future: [],
      derived: derive(draft, cabinetSpec, processorSpec),
    });
  };

  return {
    project: initial,
    selectedCabinets: [],
    selectedChain: null,
    activeSpecId: CABINET_LIBRARY[0]?.id ?? null,
    past: [],
    future: [],
    derived: derive(initial, cabinetSpec, processorSpec),

    cabinetSpecs: () => [...get().project.customCabinets, ...CABINET_LIBRARY],
    processorSpecs: () => [...get().project.customProcessors, ...PROCESSOR_LIBRARY],
    receiverSpecs: () => [...get().project.customReceivers, ...RECEIVER_LIBRARY],
    cabinetSpec,
    processorSpec,
    receiverSpec,

    commit,

    undo: () => {
      const { past, project, future } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({
        project: prev,
        past: past.slice(0, -1),
        future: [project, ...future].slice(0, HISTORY_LIMIT),
        derived: derive(prev, cabinetSpec, processorSpec),
      });
    },

    redo: () => {
      const { past, project, future } = get();
      if (!future.length) return;
      const next = future[0];
      set({
        project: next,
        past: [...past, project].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        derived: derive(next, cabinetSpec, processorSpec),
      });
    },

    loadProject: (p) =>
      set({
        project: p,
        past: [],
        future: [],
        selectedCabinets: [],
        selectedChain: null,
        derived: derive(p, cabinetSpec, processorSpec),
      }),

    setSignal: (s) => commit((d) => Object.assign(d.signal, s)),
    setCanvas: (c) => commit((d) => Object.assign(d.canvas, c)),
    setMeta: (m) => commit((d) => Object.assign(d, m)),
    setPower: (p) => commit((d) => { d.power = { ...DEFAULT_POWER_PLAN, ...d.power, ...p }; }),

    addGrid: (specId, cols, rows, xMm = 0, yMm = 0) =>
      commit((d) => {
        const spec = cabinetSpec(specId);
        if (!spec) return;
        d.cabinets.push(
          ...buildGrid(spec, cols, rows, xMm, yMm, () => nextId('cab')),
        );
      }),

    addCabinetAt: (specId, xMm, yMm, snapToGrid = true) => {
      const spec = cabinetSpec(specId);
      if (!spec) return null;
      // Minted outside the commit so it can be returned — the caller usually wants to
      // select what it just placed.
      const id = nextId('cab');
      commit((d) => {
        d.cabinets.push({
          id,
          specId,
          xMm: snapToGrid ? snap(xMm, d.canvas.snapMm || spec.widthMm) : xMm,
          yMm: snapToGrid ? snap(yMm, d.canvas.snapMm || spec.heightMm) : yMm,
          rotation: 0,
        });
      });
      return id;
    },

    moveCabinets: (ids, dxMm, dyMm, snapToGrid = true) =>
      commit((d) => {
        const set_ = new Set(ids);
        for (const c of d.cabinets) {
          if (set_.has(c.id)) {
            c.xMm = snapToGrid ? snap(c.xMm + dxMm, d.canvas.snapMm) : c.xMm + dxMm;
            c.yMm = snapToGrid ? snap(c.yMm + dyMm, d.canvas.snapMm) : c.yMm + dyMm;
          }
        }
      }),

    deleteCabinets: (ids) => {
      const set_ = new Set(ids);
      commit((d) => {
        d.cabinets = d.cabinets.filter((c) => !set_.has(c.id));
        // Keep wiring consistent: drop deleted cabinets from every chain.
        for (const chain of d.chains) {
          chain.cabinetIds = chain.cabinetIds.filter((id) => !set_.has(id));
        }
        d.chains = d.chains.filter((c) => c.cabinetIds.length > 0);
      });
      set({ selectedCabinets: [] });
    },

    /** Fill the canvas with as many whole cabinets of this spec as fit. */
    fillCanvas: (specId) =>
      commit((d) => {
        const spec = cabinetSpec(specId);
        if (!spec) return;
        const cols = Math.floor(d.canvas.widthMm / spec.widthMm);
        const rows = Math.floor(d.canvas.heightMm / spec.heightMm);
        d.cabinets = buildGrid(spec, cols, rows, 0, 0, () => nextId('cab'));
        d.chains = [];
      }),

    addProcessor: (specId) =>
      commit((d) => {
        const spec = processorSpec(specId);
        if (!spec) return;
        const n = d.processors.filter((p) => p.specId === specId).length + 1;
        d.processors.push({
          id: nextId('proc'),
          specId,
          name: `${spec.model} ${n}`,
        });
      }),

    removeProcessor: (id) =>
      commit((d) => {
        d.processors = d.processors.filter((p) => p.id !== id);
        d.chains = d.chains.filter((c) => c.processorId !== id);
      }),

    renameProcessor: (id, name) =>
      commit((d) => {
        const p = d.processors.find((x) => x.id === id);
        if (p) p.name = name;
      }),

    runAutoWire: (options) => {
      const { project } = get();
      const result = autoWire(project, cabinetSpec, processorSpec, options, () =>
        nextId('chain'),
      );
      commit((d) => {
        if (options.skipPatched) {
          d.chains = [...d.chains, ...result.chains];
        } else {
          d.chains = result.chains;
        }
      });
      return result.notes;
    },

    clearWiring: () => commit((d) => { d.chains = []; }),

    setChainOrder: (chainId, cabinetIds) =>
      commit((d) => {
        const chain = d.chains.find((c) => c.id === chainId);
        if (chain) chain.cabinetIds = cabinetIds;
      }),

    /** Patch a set of cabinets onto a port, removing them from any other chain. */
    patchCabinetsTo: (processorId, portId, cabinetIds) =>
      commit((d) => {
        const moving = new Set(cabinetIds);
        for (const chain of d.chains) {
          chain.cabinetIds = chain.cabinetIds.filter((id) => !moving.has(id));
        }
        const existing = d.chains.find(
          (c) => c.processorId === processorId && c.portId === portId,
        );
        if (existing) {
          existing.cabinetIds.push(...cabinetIds);
        } else {
          d.chains.push({
            id: nextId('chain'),
            processorId,
            portId,
            cabinetIds: [...cabinetIds],
          });
        }
        d.chains = d.chains.filter((c) => c.cabinetIds.length > 0);
      }),

    addCustomCabinet: (spec) => commit((d) => { d.customCabinets.push(spec); }),
    addCustomProcessor: (spec) => commit((d) => { d.customProcessors.push(spec); }),

    select: (ids, additive = false) =>
      set((s) => ({
        selectedCabinets: additive
          ? [...new Set([...s.selectedCabinets, ...ids])]
          : ids,
        selectedChain: null,
      })),
    selectChain: (id) => set({ selectedChain: id, selectedCabinets: [] }),
    setActiveSpec: (id) => set({ activeSpecId: id }),
  };
});

export { nextId };

/**
 * Library hooks.
 *
 * These must NOT be plain store selectors. A selector like `(s) => s.cabinetSpecs()`
 * builds a fresh array on every call, so zustand's snapshot comparison never settles
 * and React spins ("The result of getSnapshot should be cached"). Selecting the stable
 * slice and merging in a memo is the fix.
 */
export function useCabinetSpecs(): CabinetSpec[] {
  const custom = useStore((s) => s.project.customCabinets);
  return useMemo(() => [...custom, ...CABINET_LIBRARY], [custom]);
}

export function useProcessorSpecs(): ProcessorSpec[] {
  const custom = useStore((s) => s.project.customProcessors);
  return useMemo(() => [...custom, ...PROCESSOR_LIBRARY], [custom]);
}

export function useReceiverSpecs(): ReceivingCardSpec[] {
  const custom = useStore((s) => s.project.customReceivers);
  return useMemo(() => [...custom, ...RECEIVER_LIBRARY], [custom]);
}
