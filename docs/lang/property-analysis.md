# Property Test Analysis

This document analyzes the existing `checkProperties` implementations in the capability modules to identify common patterns and invariant properties. The goal is to inform a unified property test definition structure.

## Overview

Each capability module exports a `checkProperties(run)` function that:
- Takes a `run` function (which executes a source string and returns the result as a string, or throws).
- Returns an array of failure message strings. An empty array indicates all properties hold.
- Tests a combination of:
  1. Basic correctness of example expressions.
  2. Algebraic properties (commutativity, associativity, distributivity, etc.).
  3. Type safety (ensuring operations reject invalid types).
  4. Operator precedence and binding.
  5. Logical properties (e.g., double negation, idempotence).
  6. Specific error conditions (e.g., division by zero).

## Common Property Patterns

### 1. Basic Correctness
Capabilities often verify that specific expressions from their `meta.examples` (or close variants) evaluate to expected results.

**Example from arithmetic.js:**
```js
if (run('2 + 3') !== '5') {
  failures.push('2 + 3 should return "5"');
}
```

### 2. Algebraic Laws
Properties that should hold for all values in the domain (or a representative set).

- **Commutativity**: `a op b = b op a`
  - Tested for `+` and `*` in arithmetic.js.
- **Associativity**: `(a op b) op c = a op (b op c)`
  - Tested for `+` and `*` in arithmetic.js.
- **Distributivity**: `a op (b c) = (a op b) c (a op c)` (or similar)
  - Tested for negation over addition in arithmetic.js: `-(a + b) = (-a) + (-b)`.
- **Idempotence**: `a op a = a`
  - Tested for boolean `and` and `or`: `true and true = true`, `false or false = false`.
- **Absorption**: `a op (a b) = a` (not explicitly seen but common in lattices).
- **Identity**: `a op identity = a`
  - Not directly tested, but implicit in some tests (e.g., `a + 0 = a` could be added).
- **Complement**: `a op complement(a) = identity` (not seen).

### 3. Type Safety
Ensuring that operations throw appropriate errors when given operands of incorrect types.

**Example from boolean.js:**
```js
try {
  run('true and 1');
  failures.push('true and 1 should throw TypeError');
} catch (e) {
  if (!(e instanceof TypeError)) {
    failures.push('true and 1 should throw TypeError, got ' + e);
  }
}
```

### 4. Precedence and Binding
Verifying that operators bind with the correct precedence and associativity.

**Example from comparison.js:**
```js
// Precedence: comparison higher than arithmetic
if (run('1 + 2 == 3') !== 'true') {
  failures.push('1 + 2 == 3 should return "true"');
}
```

### 5. Logical Properties
Properties specific to boolean logic or similar algebras.

- **Double Negation**: `¬(¬a) = a`
  - Tested in arithmetic.js for numeric negation: `-(-5) = 5`.
- **Excluded Middle**: Not directly tested, but seen in boolean via `a or not a` (could be added).
- **De Morgan's Laws**: `¬(a and b) = (¬a) or (¬b)` (not seen in current capabilities).

### 6. Error Conditions
Checking that specific invalid inputs produce expected errors.

**Example from arithmetic.js:**
```js
// Division by zero must be rejected with a user-facing error
try {
  run('1 / 0');
  failures.push('division by zero should throw');
} catch (err) {
  if (!err.message.includes('division by zero')) {
    failures.push('division by zero should throw "division by zero" error');
  }
}
```

## Observations

1. **Representative Values**: Properties are often tested with a small set of representative values (e.g., 2, 3, 4, 5) rather than being universally quantified. This is practical for testing but assumes the properties hold generally.

2. **Error Message Checking**: When testing errors, capabilities often check that the error message includes a specific substring (rather than exact match) to allow for flexibility in error messaging.

3. **Property Composition**: Some properties are built from others (e.g., distributivity of negation over addition relies on previously defined negation and addition).

4. **Lack of Universal Quantification**: The current approach does not attempt to test properties for all possible values (which would be impossible) but uses fixed examples. This is acceptable for a test suite but note that a property like commutativity is only tested with one pair of numbers.

5. **Mix of Concerns**: The `checkProperties` function mixes basic regression tests (like checking examples) with true invariant properties. This is acceptable given the project's use of examples as both documentation and tests.

## Toward a Unified Structure

To create a unified property test definition structure, we could:

- Provide helper functions for common property patterns (commutativity, associativity, etc.) to reduce boilerplate and ensure consistency.
- Define a schema for property tests as data objects (though the current interface requires a function).
- Encourage capabilities to separate basic example verification from invariant property testing, though this is not strictly necessary.

The proposed `property-spec.js` will offer a set of utilities to make writing `checkProperties` easier and more consistent.