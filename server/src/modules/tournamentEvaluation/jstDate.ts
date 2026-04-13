/** Asia/Tokyo の暦日を YYYY-MM-DD で返す（日次クォータ用）。 */
export function getJstDateString(date: Date = new Date()): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Tokyo' });
}
