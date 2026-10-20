import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {appId:'com.engx.app',appName:'EngX',webDir:'dist',android:{allowMixedContent:false},plugins:{LocalNotifications:{smallIcon:'ic_stat_engx',iconColor:'#1FA39A'}}};
export default config;
