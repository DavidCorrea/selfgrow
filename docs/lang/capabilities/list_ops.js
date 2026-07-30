/**
 * Higher-order list operations capability — provides map, filter, and fold.
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';
import { RuntimeError, TypeError } from '../errors.js';

export const meta = {
  name: 'list_ops',
  summary: 'Higher-order list operations — map, filter, and fold',
  examples: [
    { source: 'head(listMap(fn(x) = x + 1, cons(1, cons(2, nil))))', result: '2' },
    { source: 'head(tail(listMap(fn(x) = x + 1, cons(1, cons(2, nil)))))', result: '3' },
    { source: 'length(listMap(fn(x) = x + 1, nil))', result: '0' },
    { source: 'listFold(fn(acc, x) = acc + x, 0, cons(1, cons(2, cons(3, nil))))', result: '6' },
    { source: 'listFold(fn(acc, x) = acc + x, 10, nil)', result: '10' },
    { source: 'head(listFilter(fn(x) = x > 1, cons(1, cons(2, cons(3, nil)))))', result: '2' },
    { source: 'length(listFilter(fn(x) = x > 1, cons(1, cons(2, cons(3, nil)))))', result: '2' },
    { source: 'length(listFilter(fn(x) = x > 10, cons(1, cons(2, nil))))', result: '0' },
  ],
};

function createConsCell(head, tail) {
  return { __cons: true, head, tail };
}

function describeValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value && value.__closure) return 'a closure';
  if (value && value.__cons) return 'a list cell';
  if (value && value.__record) return 'a record';
  return typeof value;
}

function applyClosure(steps, closure, args) {
  const builtins = steps.builtins || {};
  const operators = steps.operators || {};
  if (!closure || !closure.__closure) {
    throw new TypeError('a closure', 'closure', describeValue(closure), null);
  }
  if (closure.params.length !== args.length) {
    throw new TypeError(
      `Function expects ${closure.params.length} arguments but got ${args.length}`,
      `${closure.params.length} arguments`,
      `${args.length} arguments`,
      null
    );
  }
  const closureEnv = { ...closure.env };
  closure.params.forEach((param, i) => { closureEnv[param] = args[i]; });
  return steps.evaluate(closure.body, closureEnv, steps, builtins, operators);
}

function registerListOps(interpreter) {
  interpreter.registerFunction('listMap', function (args, steps) {
    if (args.length !== 2) {
      throw new RuntimeError(
        `listMap expects 2 arguments but got ${args.length}`,
        '2 arguments',
        `${args.length} arguments`,
        null
      );
    }
    const [fn, list] = args;
    if (!fn || !fn.__closure) {
      throw new TypeError('listMap: first argument', 'a closure', describeValue(fn), null);
    }
    if (list !== null && !list.__cons) {
      throw new RuntimeError('listMap: second argument', 'a list', describeValue(list), null);
    }
    // Walk the list, apply fn to each element, collect results.
    const results = [];
    let current = list;
    while (current !== null) {
      results.push(applyClosure(steps, fn, [current.head]));
      current = current.tail;
    }
    // Build the result list in reverse to preserve order.
    let newList = null;
    for (let i = results.length - 1; i >= 0; i--) {
      newList = createConsCell(results[i], newList);
    }
    return newList;
  });

  interpreter.registerFunction('listFilter', function (args, steps) {
    if (args.length !== 2) {
      throw new RuntimeError(
        `listFilter expects 2 arguments but got ${args.length}`,
        '2 arguments',
        `${args.length} arguments`,
        null
      );
    }
    const [fn, list] = args;
    if (!fn || !fn.__closure) {
      throw new TypeError('listFilter: first argument', 'a closure', describeValue(fn), null);
    }
    if (list !== null && !list.__cons) {
      throw new RuntimeError('listFilter: second argument', 'a list', describeValue(list), null);
    }
    // Walk the list, keep elements where predicate returns true.
    const kept = [];
    let current = list;
    while (current !== null) {
      const predicateResult = applyClosure(steps, fn, [current.head]);
      if (predicateResult) {
        kept.push(current.head);
      }
      current = current.tail;
    }
    // Build the result list in reverse to preserve order.
    let newList = null;
    for (let i = kept.length - 1; i >= 0; i--) {
      newList = createConsCell(kept[i], newList);
    }
    return newList;
  });

  interpreter.registerFunction('listFold', function (args, steps) {
    if (args.length !== 3) {
      throw new RuntimeError(
        `listFold expects 3 arguments but got ${args.length}`,
        '3 arguments',
        `${args.length} arguments`,
        null
      );
    }
    const [fn, initial, list] = args;
    if (!fn || !fn.__closure) {
      throw new TypeError('listFold: first argument', 'a closure', describeValue(fn), null);
    }
    if (list !== null && !list.__cons) {
      throw new RuntimeError('listFold: third argument', 'a list', describeValue(list), null);
    }
    // Walk the list left-to-right, folding the accumulator with each element.
    let acc = initial;
    let current = list;
    while (current !== null) {
      acc = applyClosure(steps, fn, [acc, current.head]);
      current = current.tail;
    }
    return acc;
  });

  }

export function register(interpreter) {
  registerListOps(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // map: applies function to each element
  if (run('head(listMap(fn(x) = x + 1, cons(1, cons(2, nil))))') !== '2') {
    failures.push('listMap head should return "2"');
  }

  // map: empty list returns empty list
  if (run('length(listMap(fn(x) = x + 1, nil))') !== '0') {
    failures.push('listMap on empty list should return length "0"');
  }

  // map: single element
  if (run('head(listMap(fn(x) = x * 3, cons(4, nil)))') !== '12') {
    failures.push('listMap single element should return "12"');
  }

  // map: preserves length
  if (run('length(listMap(fn(x) = x, cons(1, cons(2, cons(3, nil)))))') !== '3') {
    failures.push('listMap should preserve list length');
  }

  // filter: keeps elements where predicate is true
  if (run('head(listFilter(fn(x) = x > 1, cons(1, cons(2, cons(3, nil)))))') !== '2') {
    failures.push('listFilter first kept element should be "2"');
  }

  // filter: empty list returns empty list
  if (run('length(listFilter(fn(x) = true, nil))') !== '0') {
    failures.push('listFilter on empty list should return length "0"');
  }

  // filter: remove all elements
  if (run('length(listFilter(fn(x) = x > 10, cons(1, cons(2, nil))))') !== '0') {
    failures.push('listFilter removing all elements should return length "0"');
  }

  // fold: empty list returns initial value
  if (run('listFold(fn(acc, x) = acc + x, 0, nil)') !== '0') {
    failures.push('listFold on empty list should return initial value "0"');
  }

  // fold: single element list
  if (run('listFold(fn(acc, x) = acc + x, 0, cons(5, nil))') !== '5') {
    failures.push('listFold on single element should return "5"');
  }

  // fold: multi-element list, left-to-right accumulation
  if (run('listFold(fn(acc, x) = acc + x, 0, cons(1, cons(2, cons(3, nil))))') !== '6') {
    failures.push('listFold should sum to "6"');
  }

  // fold: non-zero initial value
  if (run('listFold(fn(acc, x) = acc + x, 10, cons(1, cons(2, nil)))') !== '13') {
    failures.push('listFold with initial 10 should return "13"');
  }

  // error: non-closure first argument to listMap is rejected
  try {
    run('listMap(5, nil)');
    failures.push('listMap with non-closure argument should throw');
  } catch (err) {
    if (!err.message.includes('first argument')) {
      failures.push(`listMap non-closure should throw argument error, got: ${err.message}`);
    }
  }

  // error: wrong arity for listMap is rejected
  try {
    run('listMap(fn(x) = x, nil, nil)');
    failures.push('listMap with extra argument should throw');
  } catch (err) {
    if (!err.message.includes('expects 2 arguments')) {
      failures.push(`listMap arity error should report "expects 2 arguments", got: ${err.message}`);
    }
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
