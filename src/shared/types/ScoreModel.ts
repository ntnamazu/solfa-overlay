import type { Pitch } from './Pitch';
import type { SolfaDegree } from './SolfaDegree';

/** ページ上の座標（.omr の 300dpi 画像ピクセル基準。機能設計書「座標系は2本立て」） */
export interface PageAnchor {
  /** 0始まり（曲全体のページ順） */
  pageIndex: number;
  x: number;
  y: number;
}

/** 譜表の位置参照（ページ→システム→譜表） */
export interface StaffRef {
  pageIndex: number;
  systemIndex: number;
  /** システム内の譜表順（0始まり・上から） */
  staffIndex: number;
  /** 対応パート。構造未確定・不明の場合は null */
  partId: string | null;
}

/** 照合済みの音符1つ（MusicXMLの音楽情報＋.omrの座標） */
export interface NoteEvent {
  id: string;
  partId: string;
  /** 曲頭からの通し小節番号（0始まり） */
  measureIndex: number;
  /** MusicXML由来（調号込みの実音） */
  pitch: Pitch;
  /** .omr由来の符頭座標（符頭中心） */
  head: PageAnchor;
  /** 階名計算結果。未計算・休符等は null */
  solfa: SolfaDegree | null;
}

/**
 * パート×小節の照合結果
 *
 * status が skipped の小節は音符数不一致で照合できなかった小節（用語集「スキップ小節」）。
 * 修正UIの対象として notes は空になる
 */
export interface Measure {
  partId: string;
  /** 曲頭からの通し小節番号（0始まり） */
  index: number;
  status: 'matched' | 'skipped';
  notes: NoteEvent[];
}

/** パート（例: Soprano/Alto/Tenor/Bass） */
export interface Part {
  /** MusicXML part id（= book.xml logical-id） */
  id: string;
  name: string;
  /** 譜表→パート対応（sheet XML の part id で解決） */
  staves: StaffRef[];
}

/** ページ内の段（システム）。照合時の小節範囲を保持する */
export interface SystemInfo {
  pageIndex: number;
  /** ページ内のシステム順（0始まり） */
  systemIndex: number;
  /** このシステム先頭の通し小節番号（0始まり） */
  firstMeasureIndex: number;
  /** このシステムに含まれる小節数（stack 数） */
  measureCount: number;
}

/** 認識済み楽譜の論理＋物理モデル（用語集「楽譜モデル（ScoreModel）」） */
export interface ScoreModel {
  parts: Part[];
  /** ページ内の段。誤分割の統合結果を反映 */
  systems: SystemInfo[];
  /** パート×小節（partId → 通し小節番号順） */
  measures: Measure[];
}
