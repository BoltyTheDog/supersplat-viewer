import { createInterface } from 'node:readline';
import { hashPassword } from './auth.mjs';

const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true
});

console.log('Enter a password of at least 12 characters to hash with scrypt:');
process.stdout.write('Password: ');

let password = '';
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', chunk => {
    const char = chunk.toString();
    if (char === '\r' || char === '\n' || char === '\u0004') {
        process.stdin.setRawMode?.(false);
        process.stdout.write('\n');
        rl.close();
        hashPassword(password)
            .then(hash => {
                console.log('\nSet this line in your .env file:');
                console.log(`AUTH_PASSWORD_HASH=${hash}`);
                process.exit(0);
            })
            .catch(err => {
                console.error(`\nError: ${err.message}`);
                process.exit(1);
            });
    } else if (char === '\u0003') {
        process.exit(1);
    } else if (char === '\u007f' || char === '\b') {
        password = password.slice(0, -1);
    } else {
        password += char;
    }
});
