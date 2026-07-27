/** Elapsed time between two instants, e.g. "4m", "1h 12m", "2d 3h". */
export function formatDuration(from: Date, to: Date): string {
  const totalSec = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (totalSec < 60) return `${totalSec}s`;

  const minutes = Math.floor(totalSec / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours === 0 ? `${days}d` : `${days}d ${remHours}h`;
}
