import { writeFileSync } from 'fs';
import { join } from 'path';
import { buildCssVariables } from '../src/css';

const header = `/* GENERATED FILE — do not edit by hand.
 * Regenerate with: pnpm --filter @tutak/design build:css
 * Source of truth: packages/design/src/tokens/
 */\n\n`;

const out = join(__dirname, '..', 'tutak.css');
writeFileSync(out, header + buildCssVariables(), 'utf8');
console.log(`Wrote ${out}`);
