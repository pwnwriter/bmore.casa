export const TOUR_SECONDS = 36;
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Camera distances are relative to the sampled roof/surface at the property. */
export function tourPose(seconds: number) {
  const t = Math.min(TOUR_SECONDS, Math.max(0, seconds));
  if (t < 9) {
    const k = ease(t / 9);
    return { heading: lerp(25, 55, k), radius: lerp(420, 90, k), height: lerp(280, 55, k), shot: "Approach" };
  }
  if (t < 27) {
    const k = ease((t - 9) / 18);
    return { heading: lerp(55, 305, k), radius: 90, height: lerp(55, 72, k), shot: "Property orbit" };
  }
  const k = ease((t - 27) / 9);
  return { heading: lerp(305, 350, k), radius: lerp(90, 340, k), height: lerp(72, 230, k), shot: "Neighborhood" };
}
