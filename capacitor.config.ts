import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.rnl1.codexui',
  appName: 'Codex UI',
  webDir: 'dist',
  plugins: {
    CapacitorCookies: {
      enabled: true,
    },
    CapacitorHttp: {
      enabled: true,
    },
  },
}

export default config
