/**
 * 离线回放开关（air-gapped 测试专用）。
 *
 * 抽成独立模块是因为 `lib/ai.ts` 依赖服务端模块、无法在离线测试里直接导入；
 * 这里的判定必须是纯函数，才能被单测覆盖。
 *
 * **三道门必须同时通过**，其中前两道来自环境而不是数据库——
 * 因此「误建了回放表并写了开启行」并不足以让模拟响应生效：
 *   1. 构建期是开发/测试构建（Vite `import.meta.env.DEV`）：生产构建静态替换为 false；
 *   2. 运行实例不是公开部署（`PUBLIC_ACCESS !== '1'`）；
 *   3. 控制行 `ai_replay_control(enabled) = '1'`，且回放表非空。
 */
export type ReplayGate = {
  /** 构建期信号：仅开发/测试构建为 true。 */
  buildDev: boolean;
  /** 运行实例信号：公开部署为 false。 */
  privateInstance: boolean;
  /** 数据库控制行的值。 */
  controlValue: unknown;
};

export function replayAllowed(gate: ReplayGate): boolean {
  if (!gate.buildDev) return false;
  if (!gate.privateInstance) return false;
  return gate.controlValue === '1' || gate.controlValue === 1;
}

/**
 * 当前构建是否为开发/测试构建。取不到时**一律视为不允许**，
 * 避免在未知运行时里意外放行模拟响应。
 */
export const REPLAY_BUILD_ALLOWED: boolean = (() => {
  try {
    const env = (import.meta as unknown as { env?: { DEV?: unknown } }).env;
    return env?.DEV === true;
  } catch {
    return false;
  }
})();
