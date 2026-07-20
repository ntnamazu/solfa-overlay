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
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'renderer',
          environment: 'jsdom',
          include: ['tests/unit/renderer/**/*.test.tsx'],
          setupFiles: ['tests/setup/renderer.ts'],
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
