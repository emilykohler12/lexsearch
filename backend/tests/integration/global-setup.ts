import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Brings the test database schema up to date before the integration suite.
 * Non-destructive on purpose (`migrate deploy`, not `reset`): each test file
 * deletes the rows it creates, so there is no need to drop the database.
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  // Guard rail: tests delete data, so never let them point at the real database.
  if (!url || !/\/[^/?]*_test(\?|$)/.test(url)) {
    throw new Error('TEST_DATABASE_URL debe apuntar a una base cuyo nombre termine en "_test" (ver .env.example)');
  }
  execSync('npx prisma migrate deploy', {
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
