import { describe, it, expect } from 'vitest';
import { generateShareToken, verifyShareToken } from '../utils.js';

const SECRET = 'test-secret';
const HAND_ID = 'hand-abc-123';

describe('ハンドシェアトークン', () => {
  it('9人卓の全席（0-8）で往復できる', () => {
    for (let seat = 0; seat <= 8; seat++) {
      const token = generateShareToken(HAND_ID, seat, SECRET);
      expect(verifyShareToken(HAND_ID, token, SECRET), `seat ${seat}`).toBe(seat);
    }
  });

  it('席数の上限を超える席番号は受け付けない', () => {
    const token = generateShareToken(HAND_ID, 9, SECRET);
    expect(verifyShareToken(HAND_ID, token, SECRET)).toBeNull();
  });

  it('別ハンド・別シークレット・改竄トークンは無効', () => {
    const token = generateShareToken(HAND_ID, 7, SECRET);
    expect(verifyShareToken('other-hand', token, SECRET)).toBeNull();
    expect(verifyShareToken(HAND_ID, token, 'other-secret')).toBeNull();
    expect(verifyShareToken(HAND_ID, `6.${token.split('.')[1]}`, SECRET)).toBeNull();
    expect(verifyShareToken(HAND_ID, 'no-dot', SECRET)).toBeNull();
    expect(verifyShareToken(HAND_ID, '-1.sig', SECRET)).toBeNull();
  });
});
