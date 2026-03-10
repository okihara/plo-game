export function buildStatsShareText(displayName: string): string {
  return `#BabyPLO ${displayName} - Stats`;
}

export function buildHandShareText(blinds: string, profit: number): string {
  const profitStr = profit >= 0 ? `+${profit}` : `${profit}`;
  return `#BabyPLO ${blinds} Hand (${profitStr})`;
}

export function openXShare(text: string, url: string): void {
  const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  window.open(xUrl, '_blank', 'noopener,noreferrer');
}
