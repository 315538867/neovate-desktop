/**
 * Derive a stable, perceptual color from a group id for chip rendering.
 *
 * Uses DJB2 hash → HSL so same group always gets same hue. Saturation
 * and lightness are pinned to produce subdued badge tones that work
 * across light and dark themes.
 */

export function groupColor(groupId: string): {
  hue: number;
  bg: string;
  text: string;
  dot: string;
} {
  const hue = hashDJB2(groupId) % 360;

  // CSS custom properties approach — return HSL parts so callers can
  // compose inline styles or classes.
  return {
    hue,
    bg: `hsl(${hue} 28% 88%)`,
    text: `hsl(${hue} 35% 32%)`,
    dot: `hsl(${hue} 50% 42%)`,
  };
}

function hashDJB2(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}
