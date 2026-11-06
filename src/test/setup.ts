import '@testing-library/jest-dom/vitest';
import 'vitest-axe/extend-expect';
import { expect } from 'vitest';
import { toHaveNoViolations } from 'vitest-axe/dist/matchers.js';

expect.extend({ toHaveNoViolations });
