import { run } from './lang/run.js';

// Test record data structure capability
console.log('=== Record Data Structure ===');

// Construction via literal syntax
try {
  const r = run('#{name: "x", value: 42}');
  console.log('1. Record literal:', JSON.stringify(r), r === 'a record' ? '✅' : '❌');
} catch (e) { console.log('1. ❌ Error:', e.message); }

// Field access via get function
try {
  const r = run('get(#{name: "x", value: 42}, "name")');
  console.log('2. get field:', JSON.stringify(r), r === 'x' ? '✅' : '❌');
} catch (e) { console.log('2. ❌ Error:', e.message); }

// Field access via dot notation
try {
  const r = run('#{name: "x", value: 42}.name');
  console.log('3. dot access:', JSON.stringify(r), r === 'x' ? '✅' : '❌');
} catch (e) { console.log('3. ❌ Error:', e.message); }

// Field access on nonexistent field (dot notation)
try {
  run('#{name: "x"}.missing');
  console.log('4. dot missing field: ❌ should have thrown');
} catch (e) {
  console.log('4. dot missing field error:', e.message.includes('does not exist') ? '✅' : '❌', e.message);
}

// Field access on nonexistent field (get function)
try {
  run('get(#{name: "x"}, "missing")');
  console.log('5. get missing field: ❌ should have thrown');
} catch (e) {
  console.log('5. get missing field error:', e.message.includes('does not exist') ? '✅' : '❌', e.message);
}

// Error on field access on non-record
try {
  run('42.field');
  console.log('6. dot access on number: ❌ should have thrown');
} catch (e) {
  console.log('6. dot access on number error:', e.message.includes('Cannot access field') ? '✅' : '❌', e.message);
}

// has function returns true for existing field
try {
  const r = run('has(#{name: "x"}, "name")');
  console.log('7. has existing:', JSON.stringify(r), r === 'true' ? '✅' : '❌');
} catch (e) { console.log('7. ❌ Error:', e.message); }

// has function returns false for nonexistent field
try {
  const r = run('has(#{name: "x"}, "missing")');
  console.log('8. has missing:', JSON.stringify(r), r === 'false' ? '✅' : '❌');
} catch (e) { console.log('8. ❌ Error:', e.message); }

// set returns new record (immutability)
try {
  const r = run('let r = #{name: "x"} in get(set(r, "name", "y"), "name")');
  console.log('9. set immutability:', JSON.stringify(r), r === 'y' ? '✅' : '❌');
} catch (e) { console.log('9. ❌ Error:', e.message); }

// has on empty record
try {
  const r = run('has(#{}, "anything")');
  console.log('10. has empty record:', JSON.stringify(r), r === 'false' ? '✅' : '❌');
} catch (e) { console.log('10. ❌ Error:', e.message); }
