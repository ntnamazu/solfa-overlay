/**
 * 世代バックアップのローテーション（アーキテクチャ設計書「バックアップ戦略」）
 *
 * 保存のたびに直前版を `<name>.solfaproj.bak1` へ落とし、既存の bak を 1 つずつ古い方へずらす。
 * 最新 3 世代を保持し、あふれた最古世代は捨てる（1プロジェクト数十MB想定のため上限が要る）
 */

/** 保持する世代数 */
export const BACKUP_GENERATIONS = 3;

/** ローテーションで行うファイル操作 1 つ分 */
export type BackupOperation =
  { kind: 'remove'; path: string } | { kind: 'rename'; from: string; to: string };

export function backupPath(projectPath: string, generation: number): string {
  return `${projectPath}.bak${generation}`;
}

/**
 * ローテーションの操作列を組み立てる（副作用なし＝単体テスト可能）
 *
 * **必ず古い世代から先に処理する**。若い番号から動かすと `bak1 → bak2` が既存の bak2 を
 * 上書きし、その後の `bak2 → bak3` が同じ内容を運んで**世代が全部同じものになる**。
 * この順序性こそがこのモジュールを独立させている理由なので、順序は回帰テストで固定する
 *
 * @param existing - 実在するパスの判定（呼び出し側がファイルシステムを見る）
 */
export function planRotation(
  projectPath: string,
  existing: (path: string) => boolean,
): BackupOperation[] {
  const operations: BackupOperation[] = [];

  // 最古世代は行き先がないので捨てる
  const oldest = backupPath(projectPath, BACKUP_GENERATIONS);
  if (existing(oldest)) {
    operations.push({ kind: 'remove', path: oldest });
  }

  // bak(n) → bak(n+1) を古い方から順に。逆順にすると世代が潰れる
  for (let generation = BACKUP_GENERATIONS - 1; generation >= 1; generation -= 1) {
    const from = backupPath(projectPath, generation);
    if (existing(from)) {
      operations.push({ kind: 'rename', from, to: backupPath(projectPath, generation + 1) });
    }
  }

  // 直前版の本体を最新世代へ（初回保存では本体が存在しないため何もしない）
  if (existing(projectPath)) {
    operations.push({ kind: 'rename', from: projectPath, to: backupPath(projectPath, 1) });
  }
  return operations;
}
