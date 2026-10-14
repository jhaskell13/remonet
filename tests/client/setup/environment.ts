import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library only unmounts automatically when `afterEach` is global; register it explicitly.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
