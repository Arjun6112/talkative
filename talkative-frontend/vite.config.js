import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: "localhost", // Use localhost only for camera access
    port: 5173,
    // Remove HTTPS for now - localhost works without HTTPS for getUserMedia
  },
});
