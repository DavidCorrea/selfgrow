/**
 * List data structure capability — provides cons, head, tail, and nil.
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';
import { RuntimeError } from '../errors.js';
import { getLocation } from '../interpreter.js';

export const meta = {
  name: 'list',
  summary: 'List data structure — cons, head, tail, and nil',
  examples: [
    { source: 'head(cons(1, nil))', result: '1' },
    { source: 'tail(cons(1, nil))', result: '' },
    { source: 'head(tail(cons(1, cons(2, nil))))', result: '2' },
  ],
};

function createConsCell(head, tail) {
  return { __cons: true, head, tail };
}

function registerList(interpreter) {
  interpreter.addKeyword('nil');

  interpreter.registerFunction('cons', function (args, steps) {
    if (args.length !== 2) {
      throw new RuntimeError(
        `cons expects 2 arguments but got ${args.length}`,
        '2 arguments',
        `${args.length} arguments`,
        getLocation(steps.source, steps.position)
      );
    }
    return createConsCell(args[0], args[1]);
  });

  interpreter.registerFunction('head', function (args, steps) {
    if (args.length !== 1) {
      throw new RuntimeError(
        `head expects 1 argument but got ${args.length}`,
        '1 argument',
        `${args.length} arguments`,
        getLocation(steps.source, steps.position)
      );
    }
    const lst = args[0];
    if (lst === null) {
      throw new RuntimeError('head of empty list', 'a non-empty list', 'empty list (nil)', getLocation(steps.source, steps.position));
    }
    if (!lst.__cons) {
      throw new RuntimeError('head: not a list', 'a list', describeValue(lst), getLocation(steps.source, steps.position));
    }
    return lst.head;
  });

  interpreter.registerFunction('tail', function (args, steps) {
    if (args.length !== 1) {
      throw new RuntimeError(
        `tail expects 1 argument but got ${args.length}`,
        '1 argument',
        `${args.length} arguments`,
        getLocation(steps.source, steps.position)
      );
    }
    const lst = args[0];
    if (lst === null) {
      throw new RuntimeError('tail of empty list', 'a non-empty list', 'empty list (nil)', getLocation(steps.source, steps.position));
    }
    if (!lst.__cons) {
      throw new RuntimeError('tail: not a list', 'a list', describeValue(lst), getLocation(steps.source, steps.position));
    }
    return lst.tail;
  });

  interpreter.registerFunction('length', function (args, steps) {
    if (args.length !== 1) {
      throw new RuntimeError(
        `length expects 1 argument but got ${args.length}`,
        '1 argument',
        `${args.length} arguments`,
        getLocation(steps.source, steps.position)
      );
    }
    const lst = args[0];
    if (lst === null) {
      return 0;
    }
    if (!lst.__cons) {
      throw new RuntimeError('length: not a list', 'a list', describeValue(lst), getLocation(steps.source, steps.position));
    }
    let len = 0;
    let cell = lst;
    while (cell !== null) {
      if (!cell.__cons) {
        throw new RuntimeError('length: improper list', 'a proper list', 'improper list', getLocation(steps.source, steps.position));
      }
      len++;
      cell = cell.tail;
    }
    return len;
  });

  // Node handler for Nil AST nodes
  interpreter.addNodeHandler('Nil', () => null);
}

// Helper for error messages — matches the interpreter's describeValue logic
function describeValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return `'${value}'`;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (value && value.__closure) return 'a closure';
  if (value && value.__cons) return 'a list cell';
  return typeof value;
}

export function register(interpreter) {
  registerList(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // head of non-empty list extracts the first element
  if (run('head(cons(1, nil))') !== '1') {
    failures.push('head(cons(1, nil)) should return "1"');
  }

  // tail of single-element list returns empty list (nil)
  if (run('tail(cons(1, nil))') !== '') {
    failures.push('tail(cons(1, nil)) should return "" (empty list)');
  }

  // nested head/tail navigation
  if (run('head(tail(cons(1, cons(2, nil))))') !== '2') {
    failures.push('head(tail(cons(1, cons(2, nil)))) should return "2"');
  }

  // head on empty list throws a clear error
  try {
    run('head(nil)');
    failures.push('head(nil) should throw an error');
  } catch (err) {
    if (!err.message.includes('empty list')) {
      failures.push(`head(nil) should throw "empty list" error, got: ${err.message}`);
    }
  }

  // tail on empty list throws a clear error
  try {
    run('tail(nil)');
    failures.push('tail(nil) should throw an error');
  } catch (err) {
    if (!err.message.includes('empty list')) {
      failures.push(`tail(nil) should throw "empty list" error, got: ${err.message}`);
    }
  }

  // Property: head of non-empty list is not nil (not empty string)
  const headResult = run('head(cons(1, nil))');
  if (headResult === '') {
    failures.push('head of non-empty list should not be nil (empty)');
  }

  // Property: tail of non-empty list is a list (nil or cons)
// tail of single-element list returns nil (empty), which is ""
  const tailResult = run('tail(cons(1, nil))');
  // tail of single-element list returns nil (empty), which is ""
  if (tailResult !== "") {
    failures.push("tail of single-element list should return empty list (nil)");
  }

  // length of nil is 0
  if (run('length(nil)') !== '0') {
    failures.push('length(nil) should return "0"');
  }

  // length of single-element list
  if (run('length(cons(1, nil))') !== '1') {
    failures.push('length(cons(1, nil)) should return "1"');
  }

  // length of two-element list
  if (run('length(cons(1, cons(2, nil)))') !== '2') {
    failures.push('length(cons(1, cons(2, nil))) should return "2"');
  }

  // property: length always returns a non-negative integer string
  const lenResult = run('length(cons(1, cons(2, cons(3, nil))))');
  if (!/^\d+$/.test(lenResult)) {
    failures.push('length should return a non-negative integer string');
  }
  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);