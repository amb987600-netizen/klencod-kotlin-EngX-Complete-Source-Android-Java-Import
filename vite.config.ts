import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({plugins:[react(),VitePWA({registerType:'prompt',includeAssets:['icon.svg'],manifest:{name:'EngX — Smart Maintenance',short_name:'EngX',lang:'ar',dir:'rtl',start_url:'/',display:'standalone',background_color:'#EAF2F1',theme_color:'#0E3B43',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]},workbox:{globPatterns:['**/*.{js,css,html,svg,woff2}'],navigateFallbackDenylist:[/^\/api/],maximumFileSizeToCacheInBytes:5000000}})],server:{port:5173,allowedHosts:['.manus.computer']},build:{chunkSizeWarningLimit:1500}});
