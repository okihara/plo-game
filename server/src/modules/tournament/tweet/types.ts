/**
 * トーナメント結果ツイート用のデータ型。
 * fetchTweetData.ts（DB取得）と buildResultTweet.ts（文面生成）の共通契約。
 * scripts/tournament-tweet-data.ts の JSON 出力もこの形。
 */

export interface TweetTournamentInfo {
  id: string;
  name: string;
  status: string;
  buyIn: number;
  startedAt: string | null;
  completedAt: string | null;
  /** リエントリー込みの総エントリー数 */
  totalEntries: number;
  /** 実参加者数（ユニーク登録数） */
  uniqueRegistrations: number;
  totalReentries: number;
}

export interface TweetResultEntry {
  position: number;
  userId: string;
  displayName: string;
  prize: number;
  reentries: number;
}

export interface TweetWinner {
  userId: string;
  displayName: string;
  prize: number;
  reentries: number;
}

export interface TweetHandPlayer {
  userId: string | null;
  displayName: string;
  seatPosition: number;
  startChips: number;
  profit: number;
  /** 優勝者のホールカードのみ入る（それ以外は undefined） */
  holeCards?: string[];
  /** ショーダウン時の役。ダブルボードは "B1: ... / B2: ..." 形式 */
  finalHand: string | null;
  isWinnerOfTournament: boolean;
}

export interface TweetHand {
  handNumber: number;
  createdAt: string;
  /** "SB/BB" または "SB/BB/アンティ" 形式（例 "0/0/60000" は実質BB=60000） */
  blinds: string;
  communityCards: string[];
  potSize: number;
  winnerUserIds: string[];
  winnerNames: string[];
  players: TweetHandPlayer[];
  actions: unknown;
}

export interface TournamentTweetData {
  tournament: TweetTournamentInfo;
  winner: TweetWinner | null;
  /** position 昇順。入賞人数は回によって変わるため余裕を持って上位を含む */
  topResults: TweetResultEntry[];
  /** トナメ全体の最後のNハンド（古い順） */
  lastHands: TweetHand[];
}
