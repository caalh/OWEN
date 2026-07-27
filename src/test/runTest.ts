import * as path from 'path';
import { runTests } from '@vscode/test-electron';
import { REPO_ROOT } from './paths';

async function main() {
    try {
        const extensionDevelopmentPath = REPO_ROOT;
        const extensionTestsPath = path.resolve(__dirname, './suite/index');
        await runTests({ extensionDevelopmentPath, extensionTestsPath });
    } catch (err) {
        console.error('Failed to run tests', err);
        process.exit(1);
    }
}

main();
