import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';


export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const keyPath = 'certs/dev.key';
    const certPath = 'certs/dev.crt';
    const useHttps = fs.existsSync(keyPath) && fs.existsSync(certPath);
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        https: useHttps
          ? {
              key: fs.readFileSync(keyPath),
              cert: fs.readFileSync(certPath),
            }
          : undefined,
        hmr: {
          protocol: useHttps ? 'wss' : 'ws',
          host: env.LAN_HOST || undefined,
          port: 3000,
        },
      },
      plugins: [
        VitePWA({
          registerType: 'autoUpdate',
          manifest: {
            name: 'Live Vision',
            short_name: 'LiveVision',
            start_url: '/',
            display: 'standalone',
            orientation: 'portrait',
            background_color: '#000000',
            theme_color: '#000000',
          },
        }),
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
