// Usage: npm run create-owner -- you@example.com "a long password"
// Creates the single owner account (or resets its password if one already exists).
import path from 'node:path';
try { process.loadEnvFile(path.resolve('.env')); } catch {}
const { db } = await import('../lib/db.js');
const { createOwner, hashPassword, passwordProblem, ownerExists } = await import('../lib/auth.js');
const [email, password] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: npm run create-owner -- <email> "<password, 10+ chars>"'); process.exit(1); }
const problem = passwordProblem(password, email);
if (problem) { console.error(problem); process.exit(1); }
if (ownerExists()) {
  db.prepare('UPDATE owner SET email = ?, password_hash = ? WHERE id = 1').run(email.toLowerCase(), await hashPassword(password));
  db.prepare('DELETE FROM sessions').run();
  console.log('Owner account updated; all sessions signed out.');
} else {
  await createOwner(email, password);
  console.log('Owner account created.');
}
