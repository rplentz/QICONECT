import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // O workspace de testes também instala Vite 5, enquanto a aplicação usa Vite 6.
  // O plugin é compatível em runtime; o cast evita que os tipos de duas instalações
  // distintas de Vite atravessem a configuração do workspace.
  plugins: [react() as any],
  server: {
    port: 5174,
    proxy: {
      "/api": "http://localhost:3333",
    },
  },
});
