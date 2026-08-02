import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * テスト環境を 2 系統に分ける
 *
 * - node: domain / storage / main の純粋ロジックと実データ統合テスト
 * - renderer: 画面コンポーネント（jsdom）。本 devcontainer は GUI を起動できないため、
 *   画面を自動検証できる唯一の手段としてコンポーネントテストを置く
 *   （視覚的な確認はホスト実機の `npm run dev` に委ねる。E2E は Playwright で別途）
 */

/**
 * テスト 1 件あたりの上限時間
 *
 * 既定の 5000ms への暗黙依存をやめ、CI ランナーがローカルより遅いぶんの余裕を明示的に持たせる
 * （実際に `.omr` を扱うテストが GitHub Actions 上でのみ 5000ms を超えて CI が落ちた）。
 * 遅いテストを許容する意図ではなく、健全なテストなら決して踏まない水準に置く。
 * 無効化（0）はしない。ハングやデッドロックを検出できなくなるため。
 *
 * `projects` の各設定はルート直下の `test` を継承しないため、プロジェクトごとに指定する
 */
const TEST_TIMEOUT_MS = 15_000;

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
          testTimeout: TEST_TIMEOUT_MS,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.tsx'],
          setupFiles: ['tests/setup/renderer.ts'],
          testTimeout: TEST_TIMEOUT_MS,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/domain/**', 'src/storage/**'],
      // サービスレイヤーのコアロジック 90%以上（開発ガイドライン）
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
