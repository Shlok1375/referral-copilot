import { createApp, lakebase, server } from '@databricks/appkit';
import { setupReferralRoutes } from './routes/referral-routes';

createApp({
  plugins: [
    lakebase(),
    server(),
  ],
  onPluginsReady(appkit) {
    setupReferralRoutes(appkit);
  },
}).catch(console.error);
