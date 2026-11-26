import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // rutas relativas: funciona en cualquier subcarpeta o alojamiento estático
  server: { port: 5173, open: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
