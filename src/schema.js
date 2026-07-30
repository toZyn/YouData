const VALIDATORS = {
  string: v => typeof v === 'string',
  number: v => typeof v === 'number' && !Number.isNaN(v),
  boolean: v => typeof v === 'boolean',
  integer: v => Number.isInteger(v),
  array: v => Array.isArray(v),
  object: v => v && typeof v === 'object' && !Array.isArray(v),
  any: () => true,
  email: v => typeof v === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
  url: v => typeof v === 'string' && /^https?:\/\/.+/.test(v),
  date: v => typeof v === 'string' && !isNaN(Date.parse(v)),
};

export class Schema {
  constructor(fields = {}) {
    this.fields = fields;
  }

  validate(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('Value must be an object');
    }
    for (const [field, rules] of Object.entries(this.fields)) {
      const val = value[field];
      let type = rules;
      let required = false;
      let defaultValue = undefined;
      if (rules && typeof rules === 'object' && !Array.isArray(rules)) {
        type = rules.type || 'any';
        required = rules.required || false;
        defaultValue = rules.default;
      }
      if (val === undefined && defaultValue !== undefined) {
        value[field] = defaultValue;
        continue;
      }
      if (val === undefined && required) {
        throw new Error(`Field '${field}' is required`);
      }
      if (val !== undefined) {
        const validator = VALIDATORS[type];
        if (!validator) throw new Error(`Unknown type '${type}' for field '${field}'`);
        if (!validator(val)) {
          throw new TypeError(`Field '${field}' must be of type '${type}', got ${typeof val}`);
        }
      }
    }
    return true;
  }
}

export function createSchema(fields) { return new Schema(fields); }
