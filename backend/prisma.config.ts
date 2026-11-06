import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

const datasourceUrl = new URL(env('DATABASE_URL'));
datasourceUrl.searchParams.set('schema', 'gft_inteligente');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations'
  },
  datasource: {
    url: datasourceUrl.toString()
  }
});
