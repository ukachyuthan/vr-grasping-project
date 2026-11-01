/**
 * Short synthesized tones for task feedback, so success registers without
 * reading the panel. The AudioContext is created on first use; browsers allow
 * that after a user gesture, which entering XR or pressing a button provides.
 */
let ctx: AudioContext | null = null;

/** Plays `notes` (Hz) one after another, each `step` seconds long. */
export function chime(notes: number[], step = 0.12) {
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t = t0 + i * step;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.8);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t);
      osc.stop(t + step * 2);
    });
  } catch {
    // No audio (blocked or unsupported): the banner still shows the result.
  }
}

export const SUCCESS_NOTES = [660, 880];
export const SAVED_NOTES = [660, 880, 1320];
