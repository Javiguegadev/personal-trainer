/**
 * @pt/api-client/mock — in-memory backend for development (`web:mock`) and E2E tests.
 * Imported only behind `__DEV__` + `EXPO_PUBLIC_MOCK_BACKEND`, never in production code paths.
 */
export {
  createMockApiClient,
  MOCK_DB_KEY,
  type KeyValueStorage,
  type MockApiClientOptions,
} from './backend';
export {
  MOCK_TOKEN_PREFIX,
  mockAccessToken,
  mockUserFromEmail,
  parseMockToken,
  type MockUser,
} from './identity';
