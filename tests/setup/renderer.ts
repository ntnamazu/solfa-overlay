import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// globals: false のため Testing Library の自動クリーンアップが効かない。
// 明示的に登録しないと DOM がテスト間で残り、getByText が重複でエラーになる
afterEach(() => {
  cleanup();
});
