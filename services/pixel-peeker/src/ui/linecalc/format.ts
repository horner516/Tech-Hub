/** Number formatting for the Line calc view, so the same quantity never appears two ways. */

export const int = (n: number) => Math.round(n).toLocaleString('en-GB');

export const px = (n: number) => `${int(n)} px`;

export const amps = (n: number) => `${n.toFixed(n < 10 ? 2 : 1)} A`;

export const watts = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)} kW` : `${Math.round(n)} W`;

export const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export const mm = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)} m` : `${Math.round(n)} mm`);

/** "1 panel", "3 panels" — the difference between a tool and a first draft. */
export const plural = (n: number, one: string, many = `${one}s`) => `${int(n)} ${n === 1 ? one : many}`;
