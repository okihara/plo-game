import type { HandDetail } from '../components/HandDetailDialog';

function getPos(seatPosition: number, dealerPosition: number, allSeats: number[]): string {
  if (dealerPosition < 0) return '';
  const sorted = [...allSeats].sort((a, b) => {
    return ((a - dealerPosition + 6) % 6) - ((b - dealerPosition + 6) % 6);
  });
  const index = sorted.indexOf(seatPosition);
  const count = sorted.length;
  if (count <= 1) return '';
  if (count === 2) return index === 0 ? 'BTN/SB' : 'BB';
  const posMap: Record<number, string[]> = {
    3: ['BTN', 'SB', 'BB'],
    4: ['BTN', 'SB', 'BB', 'CO'],
    5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
    6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  };
  return (posMap[count] || posMap[6]!)[index] || '';
}

function actionLine(name: string, action: string, amount: number): string {
  switch (action) {
    case 'fold':  return `${name}: folds`;
    case 'check': return `${name}: checks`;
    case 'call':  return `${name}: calls ${amount}`;
    case 'bet':   return `${name}: bets ${amount}`;
    case 'raise': return `${name}: raises to ${amount}`;
    case 'allin': return `${name}: raises to ${amount} and is all-in`;
    default:      return `${name}: ${action}${amount > 0 ? ` ${amount}` : ''}`;
  }
}

export function toPokerStarsText(hand: HandDetail): string {
  const lines: string[] = [];
  const { blinds, communityCards, players, actions, dealerPosition, createdAt, id, potSize, rakeAmount } = hand;

  const [sb, bb] = blinds.split('/').map(Number);

  const allSeats = players.map(p => p.seatPosition);

  // ディーラー順にソート（BTN → SB → BB → ...）
  const sortedPlayers = [...players].sort((a, b) =>
    ((a.seatPosition - dealerPosition + 6) % 6) - ((b.seatPosition - dealerPosition + 6) % 6)
  );

  // ヘッダー
  const d = new Date(createdAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateStr = `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} JST`;
  const handNum = id.replace(/-/g, '').slice(-12).replace(/^0+/, '') || id.slice(-6);

  lines.push(`PokerStars Hand #${handNum}: Omaha Pot Limit (${sb}/${bb}) - ${dateStr}`);
  lines.push(`Table 'PLO Game' 6-max Seat #${dealerPosition + 1} is the button`);

  for (const p of sortedPlayers) {
    lines.push(`Seat ${p.seatPosition + 1}: ${p.username}`);
  }

  // ブラインド投稿
  const isTwoHanded = players.length === 2;
  const sbPos = isTwoHanded ? 'BTN/SB' : 'SB';
  const sbPlayer = players.find(p => getPos(p.seatPosition, dealerPosition, allSeats) === sbPos);
  const bbPlayer = players.find(p => getPos(p.seatPosition, dealerPosition, allSeats) === 'BB');
  if (sbPlayer) lines.push(`${sbPlayer.username}: posts small blind ${sb}`);
  if (bbPlayer) lines.push(`${bbPlayer.username}: posts big blind ${bb}`);

  // ホールカード
  lines.push('*** HOLE CARDS ***');
  const me = players.find(p => p.isCurrentUser);
  if (me && me.holeCards.length > 0) {
    lines.push(`Dealt to ${me.username} [${me.holeCards.join(' ')}]`);
  }

  // アクションをストリート別に分割
  type StreetKey = 'preflop' | 'flop' | 'turn' | 'river';
  const byStreet: Record<StreetKey, typeof actions> = { preflop: [], flop: [], turn: [], river: [] };
  for (const a of actions) {
    const s = ((a.street || 'preflop') as StreetKey);
    if (byStreet[s]) byStreet[s].push(a);
  }

  const nameOf = (seatIndex: number, odName: string) =>
    players.find(p => p.seatPosition === seatIndex)?.username ?? odName;

  // Preflop
  lines.push('*** PRE-FLOP ***');
  for (const a of byStreet.preflop) {
    lines.push(actionLine(nameOf(a.seatIndex, a.odName), a.action, a.amount));
  }

  // Flop
  if (communityCards.length >= 3) {
    lines.push(`*** FLOP *** [${communityCards.slice(0, 3).join(' ')}]`);
    for (const a of byStreet.flop) {
      lines.push(actionLine(nameOf(a.seatIndex, a.odName), a.action, a.amount));
    }
  }

  // Turn
  if (communityCards.length >= 4) {
    lines.push(`*** TURN *** [${communityCards.slice(0, 3).join(' ')}] [${communityCards[3]}]`);
    for (const a of byStreet.turn) {
      lines.push(actionLine(nameOf(a.seatIndex, a.odName), a.action, a.amount));
    }
  }

  // River
  if (communityCards.length >= 5) {
    lines.push(`*** RIVER *** [${communityCards.slice(0, 4).join(' ')}] [${communityCards[4]}]`);
    for (const a of byStreet.river) {
      lines.push(actionLine(nameOf(a.seatIndex, a.odName), a.action, a.amount));
    }
  }

  // ショーダウン
  const foldedSeats = new Set(actions.filter(a => a.action === 'fold').map(a => a.seatIndex));
  const showPlayers = players.filter(p => !foldedSeats.has(p.seatPosition) && p.holeCards.length > 0);
  if (showPlayers.length > 1 && communityCards.length === 5) {
    lines.push('*** SHOW DOWN ***');
    for (const p of showPlayers) {
      const handName = p.finalHand ? ` (${p.finalHand})` : '';
      lines.push(`${p.username}: shows [${p.holeCards.join(' ')}]${handName}`);
    }
  }

  // コレクト
  for (const p of players) {
    if (p.profit > 0) {
      lines.push(`${p.username} collected ${p.profit} from pot`);
    }
  }

  // サマリー
  lines.push('*** SUMMARY ***');
  lines.push(`Total pot ${potSize}${rakeAmount ? ` | Rake ${rakeAmount}` : ''}`);
  if (communityCards.length > 0) {
    lines.push(`Board [${communityCards.join(' ')}]`);
  }

  for (const p of sortedPlayers) {
    const position = getPos(p.seatPosition, dealerPosition, allSeats);
    const posStr = position ? ` (${position.toLowerCase()})` : '';
    const cards = p.holeCards.length > 0 ? ` [${p.holeCards.join(' ')}]` : '';
    const folded = foldedSeats.has(p.seatPosition);

    if (folded) {
      lines.push(`Seat ${p.seatPosition + 1}: ${p.username}${posStr} folded before Showdown${cards}`);
    } else {
      const handName = p.finalHand ? ` with ${p.finalHand}` : '';
      if (p.profit > 0) {
        lines.push(`Seat ${p.seatPosition + 1}: ${p.username}${posStr} showed${cards} and won (${p.profit})${handName}`);
      } else {
        lines.push(`Seat ${p.seatPosition + 1}: ${p.username}${posStr} showed${cards} and lost${handName}`);
      }
    }
  }

  return lines.join('\n');
}
