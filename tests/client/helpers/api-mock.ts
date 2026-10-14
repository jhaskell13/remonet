import { mockApi } from './fixtures.ts';

/**
 * Shared handle for the mocked `api` module. Test files register the mock with:
 *
 *   vi.mock('../../../src/api/client.ts', async (importOriginal) => {
 *     const { apiMock } = await import('../helpers/api-mock.ts');
 *     return { ...(await importOriginal<typeof import('../../../src/api/client.ts')>()), get api() { return apiMock.current; } };
 *   });
 *
 * and call `apiMock.reset()` before each test to start from fresh spies.
 */
export const apiMock = {
  current: mockApi(),
  reset() {
    this.current = mockApi();
    return this.current;
  },
};
