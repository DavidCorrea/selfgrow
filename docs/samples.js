/**
 * Sample programs for the selfgrow language playground.
 *
 * Each sample has a name, description, source code, and expected result.
 * These are used to populate the sample dropdown in the playground editor,
 * letting users load classic algorithm examples directly into the editor.
 */
export const samples = [
  {
    name: 'Hello World',
    description: 'The classic first program — prints a greeting.',
    source: 'print("Hello, world!")',
    result: 'Hello, world!',
  },
  {
    name: 'Factorial',
    description: 'Computes factorial using recursive letrec.',
    source: `letrec factorial = fn(n) =\n  if n <= 1 then 1\n  else n * factorial(n - 1)\nend in factorial(5)`,
    result: '120',
  },
  {
    name: 'Fibonacci',
    description: 'Computes the 10th Fibonacci number using recursive letrec.',
    source: `letrec fib = fn(n) =\n  if n <= 1 then n\n  else fib(n - 1) + fib(n - 2)\nend in fib(10)`,
    result: '55',
  },
  {
    name: 'Sum of List',
    description: 'Folds a list of numbers to compute their sum.',
    source: `listFold(fn(acc, x) = acc + x, 0, cons(1, cons(2, cons(3, cons(4, cons(5, nil))))))`,
    result: '15',
  },
  {
    name: 'Product of List',
    description: 'Folds a list of numbers to compute their product.',
    source: `listFold(fn(acc, x) = acc * x, 1, cons(2, cons(3, cons(4, nil))))`,
    result: '24',
  },
  {
    name: 'Map over List',
    description: 'Doubles every element in a list using listMap.',
    source: `let double = fn(x) = x * 2 in\nhead(listMap(double, cons(1, cons(2, cons(3, nil)))))`,
    result: '2',
  },
  {
    name: 'Filter List',
    description: 'Keeps only the small numbers from a list using listFilter.',
    source: `let lessThanThree = fn(x) = x < 3 in\nlength(listFilter(lessThanThree, cons(1, cons(2, cons(3, cons(4, nil))))))`,
    result: '2',
  },
  {
    name: 'Find Maximum',
    description: 'Finds the largest number in a list using listFold.',
    source: `listFold(fn(acc, x) = if x > acc then x else acc end, 0, cons(3, cons(7, cons(1, cons(5, nil)))))`,
    result: '7',
  },
  {
    name: 'Record Access',
    description: 'Creates a record and reads a field from it.',
    source: `let person = #{name: "Alice", age: 30} in\nget(person, "name")`,
    result: 'Alice',
  },
  {
    name: 'Record Update',
    description: 'Creates a record, updates a field, and reads the new value.',
    source: `let person = #{name: "Alice", age: 30} in\nget(set(person, "age", 31), "age")`,
    result: '31',
  },
  {
    name: 'String Concatenation',
    description: 'Joins strings together with the ++ operator.',
    source: `print("Hello, " ++ "selfgrow" ++ "!")`,
    result: 'Hello, selfgrow!',
  },
  {
    name: 'String Length',
    description: 'Measures the length of a string.',
    source: `length("selfgrow")`,
    result: '8',
  },
  {
    name: 'Boolean Logic',
    description: 'Combines booleans with and, or, and not.',
    source: `print(true and false or not false)`,
    result: 'true',
  },
  {
    name: 'Comparison',
    description: 'Uses comparison operators to test relationships.',
    source: `print(10 > 5 and 3 == 3)`,
    result: 'true',
  },
  {
    name: 'Nested Functions',
    description: 'Defines a function that uses a helper function internally.',
    source: `letrec add = fn(a, b) = a + b in\nletrec double = fn(x) = add(x, x) in\ndouble(7)`,
    result: '14',
  },
  {
    name: 'List Length',
    description: 'Computes the length of a list using listFold.',
    source: `listFold(fn(acc, x) = acc + 1, 0, cons(1, cons(2, cons(3, cons(4, nil)))))`,
    result: '4',
  },
];
