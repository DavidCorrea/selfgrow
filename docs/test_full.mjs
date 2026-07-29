import { run } from './lang/run.js';

console.log('=== #198: if-as-expression in let bindings ===');

// 1. if cond then a else b end can appear inside a let binding
try {
  const r = run('let x = if true then 1 else 2 end in x');
  console.log('1. let x = if true then 1 else 2 end in x =>', JSON.stringify(r), r === '1' ? '✅' : '❌');
} catch (e) { console.log('1. ❌ Error:', e.message); }

// 2. if cond then a else b end can appear as a function argument: print(if true then 1 else 2 end) prints '1'
try {
  const r = run('print(if true then 1 else 2 end)');
  console.log('2. print(if true then 1 else 2 end) =>', JSON.stringify(r), r === '1' ? '✅' : '❌');
} catch (e) { console.log('2. ❌ Error:', e.message); }

// 3. Existing top-level if still works
try {
  const r1 = run('if true then 1 else 2 end');
  const r2 = run('if false then 1 else 2 end');
  console.log('3. Top-level if:', r1 === '1' && r2 === '2' ? '✅' : '❌', r1, r2);
} catch (e) { console.log('3. ❌ Error:', e.message); }

// 4. Examples in meta are covered by checkProperties
console.log('\n=== #199: List data structure ===');

// cons builds list, head/tail navigate
try {
  const r = run('head(tail(cons(1, cons(2, nil))))');
  console.log('1. head(tail(cons(1, cons(2, nil)))) =>', JSON.stringify(r), r === '2' ? '✅' : '❌');
} catch (e) { console.log('1. ❌ Error:', e.message); }

// length
try {
  const r1 = run('length(nil)');
  const r2 = run('length(cons(1, cons(2, nil)))');
  console.log('2. length:', r1 === '0' && r2 === '2' ? '✅' : '❌', r1, r2);
} catch (e) { console.log('2. ❌ Error:', e.message); }

// head/tail errors on empty list
try {
  run('head(nil)');
  console.log('3. head(nil) should throw ❌');
} catch (e) {
  console.log('3. head(nil) error:', e.message.includes('empty list') ? '✅' : '❌', e.message);
}
try {
  run('tail(nil)');
  console.log('3b. tail(nil) should throw ❌');
} catch (e) {
  console.log('3b. tail(nil) error:', e.message.includes('empty list') ? '✅' : '❌', e.message);
}

// Property checks
console.log('\n=== Property checks ===');
try {
  const len = run('length(cons(1, cons(2, cons(3, nil))))');
  console.log('length >= 0:', parseInt(len) >= 0 ? '✅' : '❌');
} catch (e) { console.log('length property ❌ Error:', e.message); }

try {
  const h = run('head(cons(1, nil))');
  console.log('head of non-empty list is not nil:', h !== '' ? '✅' : '❌');
} catch (e) { console.log('head property ❌ Error:', e.message); }

try {
  const t = run('tail(cons(1, nil))');
  console.log('tail of non-empty list is a list (nil):', t === '' ? '✅' : '❌');
} catch (e) { console.log('tail property ❌ Error:', e.message); }

