import { run } from './lang/run.js';

// Test if-as-expression in let binding
try {
  const result = run('let x = if true then 1 else 2 end in x');
  console.log('let x = if true then 1 else 2 end in x =>', JSON.stringify(result));
} catch (e) {
  console.log('Error:', e.message);
}

// Test if-as-function-argument
try {
  const result = run('fn add(a, b) = a + b\nadd(if true then 1 else 2 end, 3)');
  console.log('add(if true then 1 else 2 end, 3) =>', JSON.stringify(result));
} catch (e) {
  console.log('Error:', e.message);
}

// Test top-level if still works
try {
  const result = run('if true then 1 else 2 end');
  console.log('if true then 1 else 2 end =>', JSON.stringify(result));
} catch (e) {
  console.log('Error:', e.message);
}
