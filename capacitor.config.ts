import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.rnl1.codexui',
  appName: 'Codex UI',
  webDir: 'dist',
  ios: {
    limitsNavigationsToAppBoundDomains: true,
  },
}

export default config
