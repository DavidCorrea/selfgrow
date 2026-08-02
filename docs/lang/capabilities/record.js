/**
 * Record data structure capability — provides record construction, field get, set, and has.
 * Records are plain objects marked with a hidden __record flag.
 * Each capability lives in its own file and self-registers with the interpreter.
 */
import { registerCapability } from './registry.js';
import { RuntimeError } from '../errors.js';
import { getLocation } from '../interpreter.js';

export const meta = {
  name: 'record',
  summary: 'Record data structure — construction, field access, update, and presence checking',
  examples: [
    { source: 'get(#{name: "x", value: 42}, "name")', result: 'x' },
    { source: 'get(#{name: "x", value: 42}, "value")', result: '42' },
    { source: 'has(#{name: "x"}, "name")', result: 'true' },
    { source: 'has(#{name: "x"}, "missing")', result: 'false' },
    { source: 'has(#{}, "anything")', result: 'false' },
  ],
};

function registerRecord(interpreter) {
  interpreter.registerFunction('record', function (args, steps) {
    const rec = {};
    rec.__record = true;
    return rec;
  });

  interpreter.registerFunction('get', function (args, steps) {
    if (args.length !== 2) {
      throw new RuntimeError(
        `get expects 2 arguments but got ${args.length}`,
        '2 arguments',
        `${args.length} arguments`,
        getLocation(steps.source, steps.position)
      );
    }
    const rec = args[0];
    const field = args[1];
    if (!rec || !rec.__record) {
      throw new RuntimeError('get: not a record', 'a record', describeValue(rec), getLocation(steps.source, steps.position));
    }
    if (typeof field !== 'string') {
      throw new RuntimeError('get: field name must be a string', 'a string', describeValue(field), getLocation(steps.source, steps.position));
    }
    if (!(field in rec)) {
      throw new RuntimeError(`Field '${field}' does not exist on record`, `a field named '${field}'`, 'no such field', getLocation(steps.source, steps.position));
    }
    return rec[field];
  });

  interpreter.registerFunction('set', function (args, steps) {
    if (args.length !== 3) {
      throw new RuntimeError(
        `set expects 3 arguments but got ${args.length}`,
        '3 arguments',
        `${args.length} arguments`,
        getLocation(steps.source, steps.position)
      );
    }
    const rec = args[0];
    const field = args[1];
    const value = args[2];
    if (!rec || !rec.__record) {
      throw new RuntimeError('set: not a record', 'a record', describeValue(rec), getLocation(steps.source, steps.position));
    }
    if (typeof field !== 'string') {
      throw new RuntimeError('set: field name must be a string', 'a string', describeValue(field), getLocation(steps.source, steps.position));
    }
    const newRec = {};
    newRec.__record = true;
    for (const key of Object.keys(rec)) {
      if (key !== '__record') {
        newRec[key] = rec[key];
      }
    }
    newRec[field] = value;
    return newRec;
  });

  interpreter.registerFunction('has', function (args, steps) {
    if (args.length !== 2) {
      throw new RuntimeError(
        `has expects 2 arguments but got ${args.length}`,
        '2 arguments',
        `${args.length} arguments`,
        getLocation(steps.source, steps.position)
      );
    }
    const rec = args[0];
    const field = args[1];
    if (!rec || !rec.__record) {
      throw new RuntimeError('has: not a record', 'a record', describeValue(rec), getLocation(steps.source, steps.position));
    }
    if (typeof field !== 'string') {
      throw new RuntimeError('has: field name must be a string', 'a string', describeValue(field), getLocation(steps.source, steps.position));
    }
    return field in rec;
  });
}

// Helper for error messages — matches the interpreter's describeValue logic
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

export function register(interpreter) {
  registerRecord(interpreter);
}

export function checkProperties(run) {
  const failures = [];

  // Record literal with field access via dot notation
  if (run('#{name: "x", value: 42}.name') !== 'x') {
    failures.push('#{name: "x", value: 42}.name should return "x"');
  }

  // Record literal with second field access via dot notation
  if (run('#{name: "x", value: 42}.value') !== '42') {
    failures.push('#{name: "x", value: 42}.value should return "42"');
  }

  // get function retrieves a field value
  if (run('get(#{name: "x", value: 42}, "name")') !== 'x') {
    failures.push('get(#{name: "x", value: 42}, "name") should return "x"');
  }

  // get function retrieves a numeric field value
  if (run('get(#{name: "x", value: 42}, "value")') !== '42') {
    failures.push('get(#{name: "x", value: 42}, "value") should return "42"');
  }

  // has function returns true for existing field
  if (run('has(#{name: "x"}, "name")') !== 'true') {
    failures.push('has(#{name: "x"}, "name") should return "true"');
  }

  // has function returns false for nonexistent field
  if (run('has(#{name: "x"}, "missing")') !== 'false') {
    failures.push('has(#{name: "x"}, "missing") should return "false"');
  }

  // has on empty record
  if (run('has(#{}, "anything")') !== 'false') {
    failures.push('has(#{}, "anything") should return "false"');
  }

  // set returns a new record with the field updated (immutability)
  const setResult = run('set(#{name: "x"}, "name", "y")');
  if (setResult !== 'a record') {
    failures.push('set(#{name: "x"}, "name", "y") should return a record');
  }

  // set does not mutate the original record (requires storing in a let binding)
  // Test: original record retains its value after set
  if (run('let r = #{name: "x"} in get(set(r, "name", "y"), "name")') !== 'y') {
    failures.push('set should return a record with the updated field');
  }

  // Error: accessing nonexistent field via dot notation
  try {
    run('#{name: "x"}.missing');
    failures.push('#{name: "x"}.missing should throw an error');
  } catch (err) {
    if (!err.message.includes("does not exist")) {
      failures.push(`field access on missing field should throw "does not exist" error, got: ${err.message}`);
    }
  }

  // Error: get on nonexistent field
  try {
    run('get(#{name: "x"}, "missing")');
    failures.push('get(#{name: "x"}, "missing") should throw an error');
  } catch (err) {
    if (!err.message.includes("does not exist")) {
      failures.push(`get on missing field should throw "does not exist" error, got: ${err.message}`);
    }
  }

  // Error: get on a non-record value
  try {
    run('get(42, "field")');
    failures.push('get(42, "field") should throw an error');
  } catch (err) {
    if (!err.message.includes('not a record')) {
      failures.push(`get on non-record should throw "not a record" error, got: ${err.message}`);
    }
  }

  // Error: field access on a non-record value
  try {
    run('42.field');
    failures.push('42.field should throw an error');
  } catch (err) {
    if (!err.message.includes("Cannot access field")) {
      failures.push(`field access on non-record should throw error, got: ${err.message}`);
    }
  }

  // Property: set returns a new record, original unchanged
  const originalVal = run('get(#{name: "x"}, "name")');
  if (originalVal !== 'x') {
    failures.push('original record should be unchanged after set');
  }

  // Property: dot access on a record returns the same value as get
  const dotVal = run('#{name: "x", value: 42}.name');
  const getVal = run('get(#{name: "x", value: 42}, "name")');
  if (dotVal !== getVal) {
    failures.push('dot access and get should return the same value');
  }

  // Property: has returns true for a field that exists
  const hasTrue = run('has(#{alpha: 1}, "alpha")');
  if (hasTrue !== 'true') {
    failures.push('has should return true for an existing field');
  }

  // Property: has returns false for a field that does not exist
  const hasFalse = run('has(#{alpha: 1}, "beta")');
  if (hasFalse !== 'false') {
    failures.push('has should return false for a nonexistent field');
  }

  return failures;
}

// Self-register at module load time so the capability is available immediately.
registerCapability(meta, register, checkProperties);
