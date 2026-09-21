import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxyTarget = env.VITE_API_PROXY_TARGET?.trim();

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 4176,
      strictPort: true,
      headers: {
        'Cache-Control': 'no-store',
      },
      // 仅本地关闭Mock并配置目标地址时启用；客户工程应合并到其现有代理/网关配置。
      proxy: proxyTarget
        ? {
            '/ai-review-api': {
              target: proxyTarget,
              changeOrigin: true,
              secure: false,
            },
          }
        : undefined,
    },
    preview: {
      host: '0.0.0.0',
      port: 4176,
      strictPort: true,
    },
  };
});
