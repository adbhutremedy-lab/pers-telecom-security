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
