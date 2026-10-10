import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { resetPrefersColorScheme } from './test/matchMedia';

afterEach(() => {
  cleanup();
  if (typeof window !== 'undefined') localStorage.clear();
  resetPrefersColorScheme();
});
