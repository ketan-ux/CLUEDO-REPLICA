import { readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const svg = readFileSync('/tmp/board.svg', 'utf8');
const resvg = new Resvg(svg, { background: '#0a0b0e', fitTo: { mode: 'width', value: 900 } });
const png = resvg.render().asPng();
writeFileSync('/tmp/board.png', png);
console.log('wrote', png.length, 'bytes');
