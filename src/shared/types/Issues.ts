import type { PitchStep } from './Pitch';
import type { StaffRef } from './ScoreModel';

/**
 * 解析パイプラインが検出した問題（例外にせず部分結果と共に返す）
 *
 * 機能設計書「エラーハンドリング」＝ 部分失敗は全体を失敗にしない。すべて位置情報を持つため、
 * 確認画面がそのままハイライト位置として使える。
 *
 * **domain ではなく shared に置く理由**: これらは確認画面（Renderer）へ IPC 越しに送る
 * 表示用データであり、`shared/ipc/contract.ts` が型として参照する。shared はどのレイヤーにも
 * 依存できない（アーキテクチャ設計書「依存方向」）ため、domain 側に置いたままでは契約を書けない。
 * `StructureDecision` を shared へ移したのと同じ理由づけ
 */

/** 譜表構造の問題（`BookStructureResolver.detect` の結果。StructureConfirm 画面の表示材料） */
export type StructureIssue =
  | {
      kind: 'movementCountMismatch';
      /** book.xml の movement 分割数 */
      omrMovementCount: number;
      /** Audiveris が出力した MusicXML の数 */
      musicXmlCount: number;
    }
  | {
      kind: 'pageCountMismatch';
      movementIndex: number;
      omrPageCount: number;
      xmlPageCount: number;
    }
  | {
      kind: 'systemCountMismatch';
      movementIndex: number;
      pageIndex: number;
      omrSystemCount: number;
      xmlSystemCount: number;
    }
  | {
      kind: 'systemMeasureCountMismatch';
      movementIndex: number;
      pageIndex: number;
      systemIndex: number;
      /** .omr の stack 数 */
      omrStackCount: number;
      /** MusicXML の段レイアウト上の小節数（こちらを採用する） */
      xmlMeasureCount: number;
    }
  | {
      kind: 'inconsistentSystemStaffCount';
      movementIndex: number;
      pageIndex: number;
      /** ページ内の段ごとの譜表数（不揃い＝段の検出が疑わしい） */
      staffCounts: number[];
    }
  | {
      kind: 'pageCorrespondenceMismatch';
      /** book.xml が列挙するページ数 */
      bookPageCount: number;
      /** 実際に sheet XML を持つページ数 */
      artifactPageCount: number;
    };

/** 照合中に検出した問題（`ScoreModelBuilder.build` の結果） */
export type BuildIssue =
  | {
      kind: 'measureCountMismatch';
      partId: string;
      measureIndex: number;
      pageIndex: number;
      systemIndex: number;
      omrCount: number;
      xmlCount: number;
    }
  | {
      kind: 'pitchCrossCheckMismatch';
      noteId: string;
      partId: string;
      measureIndex: number;
      /**
       * 不一致が起きた譜表
       *
       * 確認画面はパート×検出音部記号でグルーピングするため、パートだけでは
       * どのグループの不一致か決まらない（divisi の P6 は ALTO 35 段と TREBLE 8 段に分かれる）。
       * Editor が不一致箇所へジャンプする際の位置情報も兼ねる
       */
      staffRef: StaffRef;
      /** MusicXML 由来の音名（採用される値） */
      expectedStep: PitchStep;
      /** .omr の譜表位置＋音部記号から逆算した音名 */
      omrStep: PitchStep;
    }
  | {
      kind: 'unknownClef';
      pageIndex: number;
      systemIndex: number;
      staffIndex: number;
      partId: string;
      clefKind: string;
    }
  | { kind: 'partNotFound'; partId: string; pageIndex: number; systemIndex: number }
  | {
      kind: 'measureOutOfRange';
      partId: string;
      pageIndex: number;
      systemIndex: number;
      measureIndex: number;
    }
  | {
      /** 確定構造が存在を主張する小節に対応する stack が .omr にない（小節線の検出漏れ等） */
      kind: 'measureNotDetected';
      partId: string;
      pageIndex: number;
      systemIndex: number;
      measureIndex: number;
    };

/** 1 小節分の有効な調（調号＋旋法）。`KeyRegionIssue` の報告にも使う */
export interface AdoptedKey {
  fifths: number;
  mode: 'major' | 'minor';
}

/**
 * 調文脈（KeyRegion）の生成で検出した問題（`KeyRegionBuilder.build` の結果）
 *
 * 実データでは調号の食い違いが日常的に起きるため、報告に留めて訂正は確認画面（F-2）へ委ねる
 */
export type KeyRegionIssue =
  | {
      /** 同じ小節でパートごとに有効な調が食い違う（多数決で 1 つに決めた） */
      kind: 'keySignatureConflict';
      measureIndex: number;
      /**
       * パートID → その小節で有効だった調
       *
       * 調号（fifths）だけでなく旋法（mode）も持つ。fifths のみで食い違いを判定していた頃は、
       * パート間で旋法だけが違う場合に無言で多数決処理されていた。確認画面で旋法を
       * 指定できるようにする以上、報告側も旋法を表現できなければ訂正材料にならない
       */
      keyByPart: Record<string, AdoptedKey>;
      adopted: AdoptedKey;
    }
  | {
      /** 五度圏の範囲（-7〜+7）を外れた調号。その宣言は無視し、直前の調号を維持する */
      kind: 'unsupportedKeySignature';
      measureIndex: number;
      /** MusicXML の宣言由来なら partId、ユーザー訂正由来なら null */
      partId: string | null;
      fifths: number;
    }
  | {
      /**
       * 訂正対象の調文脈が見つからない（自動検出された区間の開始位置と一致しない）
       *
       * 区間そのものの新規追加は F-6（小節途中の転調指定）の担当であり、本コンポーネントは
       * 既存区間の訂正しか行わない。ユーザー入力由来のため例外にはせず報告に留める
       */
      kind: 'unmatchedKeyDecision';
      measureIndex: number;
    };
