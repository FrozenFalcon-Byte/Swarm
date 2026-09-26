/* A soft "pop" made on the spot with Web Audio: no files to download, nothing louder than a tap. */

let ctx: AudioContext | null = null

export function pop(pitch = 1) {
  try {
    ctx ??= new AudioContext()
    if (ctx.state === 'suspended') void ctx.resume()
    const t = ctx.currentTime
    const osc = ctx.createOscillator(), gain = ctx.createGain()
    osc.type = 'sine'
    // a little drop in pitch is what makes it sound like a bubble rather than a beep
    osc.frequency.setValueAtTime(640 * pitch, t)
    osc.frequency.exponentialRampToValueAtTime(240 * pitch, t + 0.08)
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.07, t + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.12)
  } catch { /* no audio here; that's fine */ }
}
