const FALLBACK_WHEEL_STEP = 100;
const MAX_WHEEL_DELTA = 1_200;

export interface NativeBrowserWheelDelta {
  deltaY?: number;
  wheelTicksY?: number;
}

/** Converts Electron's positive-up wheel delta to the DOM positive-down convention. */
export function toCanvasWheelDeltaY(input: NativeBrowserWheelDelta): number | null {
  const nativeDelta = Number.isFinite(input.deltaY) && input.deltaY !== 0
    ? input.deltaY!
    : Number.isFinite(input.wheelTicksY)
      ? input.wheelTicksY! * FALLBACK_WHEEL_STEP
      : 0;
  if (nativeDelta === 0) return null;
  return Math.max(-MAX_WHEEL_DELTA, Math.min(MAX_WHEEL_DELTA, -nativeDelta));
}
