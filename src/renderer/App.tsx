import { Home } from './screens/Home/Home';

// 画面遷移（Home → OmrProgress → StructureConfirm → ClefKeyConfirm → Editor → Export）は
// 各画面の実装時に導入する。現時点は Home のみ
export function App() {
  return <Home />;
}
