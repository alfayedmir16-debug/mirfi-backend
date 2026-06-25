require('ts-node/register');
try {
  require('./src/server.ts');
  console.log('SERVER STARTED OK');
} catch (e) {
  console.error('=== ERROR MESSAGE ===');
  console.error(e.message);
  console.error('=== STACK (first 5 lines) ===');
  console.error(e.stack.split('\n').slice(0, 5).join('\n'));
  process.exit(1);
}
