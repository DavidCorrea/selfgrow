import './docs/lang/capabilities/index.js';
import { getAllMeta } from './docs/lang/capabilities/registry.js';

const meta = getAllMeta();
console.log('Registered capabilities:');
meta.forEach(m => console.log(` - ${m.name}: ${m.summary}`));
console.log('\nNames:', meta.map(m => m.name));