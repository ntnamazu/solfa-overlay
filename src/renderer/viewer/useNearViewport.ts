import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

/**
 * 要素が画面の近く（おおむね前後 1 画面分）にあるか
 *
 * 楽譜プレビューの遅延描画に使う（アーキテクチャ設計書「表示中ページ±1のみレンダリング」）。
 * 50 ページ・5,000 音の曲で全ページのキャンバスと注釈を一度に作ると、
 * 操作の応答 1 秒以内（PRD 非機能要件）を守れない。
 *
 * IntersectionObserver が無い環境（jsdom の画面テスト）では常に「近い」とみなす。
 * 遅延描画は性能のための最適化であり、無い環境で何も描かなくなるほうが困るため
 */
export function useNearViewport(target: RefObject<Element | null>): boolean {
  const supported = typeof IntersectionObserver !== 'undefined';
  const [near, setNear] = useState(!supported);

  useEffect(() => {
    const element = target.current;
    if (!supported || element === null) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (entry !== undefined) {
          setNear(entry.isIntersecting);
        }
      },
      // 上下に 1 画面分の余白を取り、スクロールで見えてくる前に描き始める
      { rootMargin: '100% 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [target, supported]);

  return near;
}
