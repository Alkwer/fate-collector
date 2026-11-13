import babelParser from '@babel/eslint-parser'
import hooks from 'eslint-plugin-react-hooks'
import accessibility from 'eslint-plugin-jsx-a11y'

// Syntax-only lint; TypeScript 7 remains the type checker. Babel avoids running
// a second, incompatible TypeScript compiler inside the lint process.
export default [{
  ignores: ['worker/bindings.d.ts'],
  files: ['src/**/*.{ts,tsx}', 'shared/**/*.ts', 'worker/**/*.ts'],
  languageOptions: { parser: babelParser, parserOptions: { requireConfigFile: false, babelOptions: {
    babelrc: false, configFile: false, parserOpts: { plugins: ['typescript', 'jsx'] },
  } } },
  plugins: { 'react-hooks': hooks, 'jsx-a11y': accessibility },
  rules: {
    'no-constant-binary-expression': 'error', 'no-unreachable': 'error', 'no-unsafe-finally': 'error',
    'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'error',
    'jsx-a11y/alt-text': 'error', 'jsx-a11y/anchor-is-valid': 'error', 'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-proptypes': 'error', 'jsx-a11y/aria-role': 'error', 'jsx-a11y/click-events-have-key-events': 'error',
    'jsx-a11y/interactive-supports-focus': 'error', 'jsx-a11y/no-autofocus': 'error',
  },
}]
