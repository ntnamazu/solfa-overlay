// レイヤー境界の強制はこの設定が正（アーキテクチャ設計書「依存方向」参照）
import importPlugin from 'eslint-plugin-import';
import reactHooks from 'eslint-plugin-react-hooks';
import prettierConfig from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/** レイヤーごとの禁止 import パターン（@typescript-eslint/no-restricted-imports 用） */
const layerBoundaries = [
  {
    // サービスレイヤー: Electron・Node API・他レイヤーに依存しない純粋TS
    files: ['src/domain/**/*.ts'],
    patterns: [
      {
        group: [
          'electron',
          'electron/*',
          'node:*',
          '**/main/**',
          '**/renderer/**',
          '**/preload/**',
          '**/storage/**',
        ],
        message: 'domain は純粋TSを維持する（shared 以外へ依存しない）',
      },
    ],
  },
  {
    // データレイヤー: 呼び出される側に徹する
    files: ['src/storage/**/*.ts'],
    patterns: [
      {
        group: ['**/domain/**', '**/renderer/**', '**/main/**'],
        message: 'storage は domain/renderer/main に依存しない',
      },
    ],
  },
  {
    // UIレイヤー: 型付きIPCのみ。Node API・他レイヤー実体へのアクセス禁止
    files: ['src/renderer/**/*.ts', 'src/renderer/**/*.tsx'],
    patterns: [
      {
        group: ['electron', 'electron/*', 'node:*', '**/main/**', '**/domain/**', '**/storage/**'],
        message: 'renderer は preload の型と shared のみ参照できる',
      },
      {
        group: ['**/preload/**'],
        allowTypeImports: true,
        message: 'renderer から preload は import type のみ許可',
      },
    ],
  },
  {
    // preload: セキュリティ境界。公開APIの組み立てに限定
    files: ['src/preload/**/*.ts'],
    patterns: [
      {
        group: ['**/domain/**', '**/storage/**', '**/renderer/**'],
        message: 'preload は shared の型と IPC 呼び出しに限定する',
      },
    ],
  },
  {
    // shared: 全レイヤーから参照される型・定数のみ（実装ロジック・依存を持たない）
    files: ['src/shared/**/*.ts'],
    patterns: [
      {
        group: [
          'electron',
          'electron/*',
          'node:*',
          '**/main/**',
          '**/renderer/**',
          '**/preload/**',
          '**/domain/**',
          '**/storage/**',
        ],
        message: 'shared はどのレイヤーにも依存しない',
      },
    ],
  },
];

export default tseslint.config(
  { ignores: ['out/', 'dist/', 'node_modules/', 'coverage/', 'resources/'] },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
    plugins: { import: importPlugin },
    settings: {
      'import/resolver': {
        node: { extensions: ['.js', '.mjs', '.ts', '.tsx'] },
      },
    },
    rules: {
      'import/no-cycle': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  ...layerBoundaries.map(({ files, patterns }) => ({
    files,
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { patterns }],
    },
  })),
  {
    files: ['src/renderer/**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  prettierConfig,
);
