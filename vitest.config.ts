import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 모든 테스트 대상은 pure helper 라 node env 면 충분.
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // electron-vite 가 build 산출물을 out/ 에 두므로 거기는 무시.
    exclude: ['node_modules', 'out', 'dist']
  }
})
