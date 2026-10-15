/**
 * Proves the mail credentials before anything depends on them.
 *
 *   npm run mail:check              -- verify the login only, sends nothing
 *   npm run mail:check you@x.com    -- also send one real test message
 *
 * Verifying separately from sending matters: a failed send could be the
 * credentials, the recipient, or the message, and this tells you which.
 */
import { config } from 'dotenv';
import path from 'node:path';

config({ path: path.join(process.cwd(), '.env.local'), quiet: true });

async function main(): Promise<void> {
  const { gmailProvider, verifyGmail } = await import('../src/lib/mail/gmail');

  console.log('\n  Mail check\n  ' + '-'.repeat(60) + '\n');

  if (!gmailProvider.configured) {
    console.log('  FAIL  Not configured.');
    console.log('        Set CHIEFOS_GMAIL_USER and CHIEFOS_GMAIL_APP_PASSWORD');
    console.log('        in chiefos/.env.local, then run this again.\n');
    process.exit(1);
  }

  console.log(`  Account: ${gmailProvider.label}`);

  const verified = await verifyGmail();
  console.log(`  ${verified.ok ? 'PASS' : 'FAIL'}  ${verified.message}\n`);
  if (!verified.ok) process.exit(1);

  const to = process.argv[2];
  if (!to) {
    console.log('  Credentials are good. Nothing sent.');
    console.log('  To send a real test:  npm run mail:check you@example.com\n');
    return;
  }

  const result = await gmailProvider.send({
    to,
    subject: 'ChiefOS mail check',
    text: 'If you are reading this, ChiefOS can send mail through this account.',
    html: '<p style="font-family:sans-serif">If you are reading this, ChiefOS can send mail through this account.</p>',
  });

  console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  ${result.message}`);
  if (result.ok) console.log(`        Check ${to} - including the spam folder.\n`);
  process.exit(result.ok ? 0 : 1);
}

void main();
