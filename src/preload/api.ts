/**
 * contextBridge で Renderer に公開する型付きAPI
 *
 * Renderer からは `import type` でのみ参照する（セキュリティ境界。実体は preload/index.ts）
 */
export interface SolfaOverlayApi {
  getAppVersion(): Promise<string>;
}
