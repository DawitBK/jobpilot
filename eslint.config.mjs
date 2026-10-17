import jobpilot from './packages/config/eslint.mjs';

export default [
  { ignores: ['legacy/**', '**/dist/**', '**/.turbo/**', '**/coverage/**'] },
  ...jobpilot,
];
