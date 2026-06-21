import { cryptoTests } from './tests/crypto';
import { databaseTests } from './tests/database';
import { integrationTests } from './tests/integration';
import { storageTests } from './tests/storage';

export { type TestCase, type TestResult, type TestStatus } from './runner';

export const allDevTests = [...cryptoTests, ...databaseTests, ...integrationTests, ...storageTests];
