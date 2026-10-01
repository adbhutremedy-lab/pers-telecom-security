let ctx: AudioContext | null = null;

/** Short alert beep (no audio file needed). Browsers only allow sound after the user has clicked once. */
export function beep(kind: "alert" | "ok" = "alert") {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
    const tones = kind === "alert" ? [880, 660, 880] : [660, 880];
    tones.forEach((f, i) => {
      const o = ctx!.createOscillator();
      const g = ctx!.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx!.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx!.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx!.currentTime + i * 0.18 + 0.16);
      o.connect(g).connect(ctx!.destination);
      o.start(ctx!.currentTime + i * 0.18);
      o.stop(ctx!.currentTime + i * 0.18 + 0.17);
    });
  } catch {
    /* sound is a nice-to-have */
  }
}

let sirenTimer: number | null = null;
let sirenStop: (() => void) | null = null;

/** Prepare audio from a tap (browsers only allow sound after a user gesture). */
export function unlockAudio() {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = ctx ?? new AC();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* ignore */
  }
}

/** A looping two-tone siren and vibration for an incoming incident offer. Call the returned function (or stopSiren) to silence it. */
export function startSiren(): () => void {
  stopSiren();
  try {
    unlockAudio();
    if (ctx) {
      const c = ctx;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = "square";
      g.gain.value = 0.18;
      o.connect(g).connect(c.destination);
      o.start();
      let high = false;
      const swap = () => {
        high = !high;
        o.frequency.setValueAtTime(high ? 960 : 640, c.currentTime);
      };
      swap();
      const t = window.setInterval(swap, 420);
      sirenStop = () => {
        window.clearInterval(t);
        try {
          o.stop();
          o.disconnect();
          g.disconnect();
        } catch {
          /* already stopped */
        }
      };
    }
  } catch {
    /* sound is optional */
  }
  const buzz = () => {
    try {
      navigator.vibrate?.([450, 150, 450, 150, 900]);
    } catch {
      /* not supported */
    }
  };
  buzz();
  sirenTimer = window.setInterval(buzz, 2400);
  return stopSiren;
}

export function stopSiren() {
  if (sirenTimer !== null) {
    window.clearInterval(sirenTimer);
    sirenTimer = null;
  }
  sirenStop?.();
  sirenStop = null;
  try {
    navigator.vibrate?.(0);
  } catch {
    /* ignore */
  }
}
