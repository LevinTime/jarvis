let haptics = true;

export function setHaptics(on: boolean): void {
  haptics = on;
}

export function pulse(ms = 10): void {
  if (!haptics) {
    return;
  }
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* some browsers throw if vibration is blocked */
  }
}
