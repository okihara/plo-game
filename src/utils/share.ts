export function buildStatsShareText(displayName: string): string {
  return `#BabyPLO ${displayName} - Stats`;
}

export function openXShare(text: string, url: string): void {
  const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(xUrl, '_blank', 'noopener,noreferrer');
}
