import { describe, expect, it } from 'vitest';
import { isKnownClefKind } from '../../../../src/domain/score/clefTable';
import {
  LABELED_CLEF_KINDS,
  clefCheckStatus,
  clefCheckStatusLabel,
  clefLabel,
  countAllSystems,
  countSystems,
  mismatchLabel,
  needsAttention,
  partDisplayName,
  partLabel,
  staffCoverageLabel,
} from '../../../../src/renderer/labels/scoreLabels';
import { SELECTABLE_CLEF_KINDS } from '../../../../src/shared/types/Confirmation';
import { confirmationItem } from '../fixtures';

describe('clefLabel', () => {
  it.each([
    ['TREBLE', 'ト音記号'],
    ['BASS', 'ヘ音記号'],
    ['ALTO', 'アルト記号（ハ音記号・第3線）'],
    ['TENOR', 'テノール記号（ハ音記号・第4線）'],
    ['TREBLE_DOWN_8', 'オクターヴ下ト音記号（テノールで頻出）'],
    ['UNKNOWN', '読み取れませんでした'],
  ])('%s を日本語にする', (kind, expected) => {
    expect(clefLabel(kind)).toBe(expected);
  });

  it('選べる音部記号はすべて表示名を持つ（選べるのに名前が無い状態を作らない）', () => {
    for (const kind of SELECTABLE_CLEF_KINDS) {
      expect(clefLabel(kind)).not.toBe('未対応の音部記号');
    }
  });

  it.each([
    ['G_CLEF', 'ト音記号'],
    ['F_CLEF', 'ヘ音記号'],
  ])('別名の %s も同義の表示名になる（検出値としては現れうる）', (kind, expected) => {
    expect(clefLabel(kind)).toBe(expected);
  });

  it('表にない内部値でも内部値を画面に出さない', () => {
    expect(clefLabel('PERCUSSION')).toBe('未対応の音部記号');
    expect(clefLabel('PERCUSSION')).not.toContain('PERCUSSION');
  });

  it('「読み取れませんでした」と「未対応」を区別する（前者は検出漏れ、後者は解釈不能）', () => {
    expect(clefLabel('UNKNOWN')).not.toBe(clefLabel('PERCUSSION'));
  });

  it('表示名を持つ音部記号は、必ず domain 側でも検算に使える', () => {
    // ズレると「未対応と表示しているのに確認済み扱い」という食い違いが生まれる
    for (const kind of LABELED_CLEF_KINDS) {
      expect(isKnownClefKind(kind)).toBe(true);
    }
  });
});

describe('partDisplayName', () => {
  it('楽譜が持つパート名を優先する', () => {
    expect(partDisplayName('P1', 'Soprano')).toBe('Soprano');
  });

  it.each([
    ['名前が partId と同じ（part-name のない楽譜）', 'P1', 'P1'],
    ['名前が空', 'P1', ''],
    ['名前が無い', 'P1', undefined],
  ])('%s なら内部 ID を出さず「上から N 番目」にする', (_case, partId, name) => {
    expect(partDisplayName(partId, name)).toBe('上から1番目のパート');
  });

  it('パートが未確定でも表示できる', () => {
    expect(partDisplayName(null, undefined)).toBe('パート不明');
  });
});

describe('partLabel', () => {
  it.each([
    ['P1', '上から1番目のパート'],
    ['P4', '上から4番目のパート'],
    ['P12', '上から12番目のパート'],
  ])('%s を「上から N 番目のパート」にする', (partId, expected) => {
    expect(partLabel(partId)).toBe(expected);
  });

  it('パートが未確定でも表示できる', () => {
    expect(partLabel(null)).toBe('パート不明');
  });

  it('P+数字の形式でなければそのまま出す（勝手な番号を作らない）', () => {
    expect(partLabel('Soprano')).toBe('Soprano');
    expect(partLabel('P1a')).toBe('P1a');
  });

  it('「段」という語を使わない（本プロジェクトの段はシステムを指すため衝突する）', () => {
    expect(partLabel('P1')).not.toContain('段');
  });
});

describe('clefCheckStatus', () => {
  it('検出値があり不一致 0 件なら確認済み', () => {
    expect(clefCheckStatus(confirmationItem({ detected: 'TREBLE', mismatchCount: 0 }))).toBe(
      'confirmed',
    );
  });

  it('検出値があり不一致があれば要確認', () => {
    expect(clefCheckStatus(confirmationItem({ detected: 'ALTO', mismatchCount: 402 }))).toBe(
      'needsCheck',
    );
  });

  it('UNKNOWN は不一致 0 件でも未検査（クロスチェックが走っていないため）', () => {
    expect(clefCheckStatus(confirmationItem({ detected: 'UNKNOWN', mismatchCount: 0 }))).toBe(
      'unchecked',
    );
  });

  it('未対応の音部記号も未検査（headStepOctave が検算を打ち切るのは UNKNOWN だけではない）', () => {
    expect(clefCheckStatus(confirmationItem({ detected: 'PERCUSSION', mismatchCount: 0 }))).toBe(
      'unchecked',
    );
  });

  it('訂正済みなら、不一致が残っていても訂正済みとして扱う', () => {
    expect(
      clefCheckStatus(
        confirmationItem({ detected: 'UNKNOWN', corrected: 'TREBLE', mismatchCount: 3 }),
      ),
    ).toBe('corrected');
  });
});

describe('needsAttention', () => {
  it('要確認と未検査だけが確認を要する', () => {
    expect(needsAttention('needsCheck')).toBe(true);
    expect(needsAttention('unchecked')).toBe(true);
    expect(needsAttention('confirmed')).toBe(false);
    expect(needsAttention('corrected')).toBe(false);
  });
});

describe('clefCheckStatusLabel', () => {
  it('確認が必要な状態にはバッジを付ける', () => {
    expect(clefCheckStatusLabel('needsCheck')).toBe('⚠ 要確認');
    expect(clefCheckStatusLabel('unchecked')).toBe('⚠ 未検査');
  });

  it('確認不要な状態にはバッジを付けない', () => {
    expect(clefCheckStatusLabel('confirmed')).toBe('確認済み');
    expect(clefCheckStatusLabel('corrected')).toBe('訂正済み');
  });
});

describe('mismatchLabel', () => {
  it('0 件は数字を出さない（目が要確認の行へ向くように）', () => {
    expect(mismatchLabel(0)).toBe('—');
  });

  it('件数には単位を付ける', () => {
    expect(mismatchLabel(402)).toBe('402 音');
  });

  it('分母は出さない（件数の大小と危険度が比例しないため）', () => {
    expect(mismatchLabel(3)).not.toContain('/');
    expect(mismatchLabel(3)).not.toContain('%');
  });
});

describe('staffCoverageLabel', () => {
  it('曲全体の段数を分母に置く', () => {
    expect(staffCoverageLabel(35, 43)).toBe('全 43 段のうち 35 段');
  });

  it('全段数が求まらないときは分母を偽らない', () => {
    expect(staffCoverageLabel(0, 0)).toBe('0 段');
  });
});

describe('countSystems', () => {
  it('1 段に複数の譜表を持つパートでも段数を水増ししない（大譜表）', () => {
    // ピアノ伴奏のような 1 パート 2 譜表。譜表数で数えると 4 段になり、分母を超えうる
    const staffRefs = [
      { pageIndex: 0, systemIndex: 0, staffIndex: 0, partId: 'P1' },
      { pageIndex: 0, systemIndex: 0, staffIndex: 1, partId: 'P1' },
      { pageIndex: 0, systemIndex: 1, staffIndex: 0, partId: 'P1' },
      { pageIndex: 0, systemIndex: 1, staffIndex: 1, partId: 'P1' },
    ];
    expect(countSystems(staffRefs)).toBe(2);
  });

  it('譜表参照が空なら 0', () => {
    expect(countSystems([])).toBe(0);
  });
});

describe('countAllSystems', () => {
  it('ページと段の組で数える（同じ段の複数パートを二重に数えない）', () => {
    const items = [
      confirmationItem({
        staffRefs: [
          { pageIndex: 0, systemIndex: 0, staffIndex: 0, partId: 'P1' },
          { pageIndex: 0, systemIndex: 1, staffIndex: 0, partId: 'P1' },
        ],
      }),
      confirmationItem({
        staffRefs: [
          { pageIndex: 0, systemIndex: 0, staffIndex: 1, partId: 'P2' },
          { pageIndex: 1, systemIndex: 0, staffIndex: 1, partId: 'P2' },
        ],
      }),
    ];
    expect(countAllSystems(items)).toBe(3);
  });

  it('確認項目が空なら 0', () => {
    expect(countAllSystems([])).toBe(0);
  });
});
