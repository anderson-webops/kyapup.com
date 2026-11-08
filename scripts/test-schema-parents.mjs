import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

const root = path.resolve(import.meta.dirname, '..')
const current = createRequire(import.meta.url)
const original = createRequire(path.join(root, 'vendor/schema-parents/upstream/package.json'))
const eslintDirectory = resolver => path.dirname(resolver.resolve('eslint/package.json'))
const factory = resolver => resolver(path.join(eslintDirectory(resolver), 'lib/shared/ajv.js'))

async function temporary(context) {
  const area = path.join(root, '.ai-work/runs')
  await mkdir(area, { recursive: true })
  const directory = await mkdtemp(path.join(area, 'schema-parents-'))
  context.after(() => rm(directory, { recursive: true, force: true }))
  return directory
}

test('draft04 ignores nullable by default without loosening its actual type checks', () => {
  for (const resolver of [original, current]) {
    const validator = factory(resolver)().compile({ type: 'string', nullable: true })
    assert.equal(validator('valid'), true)
    assert.equal(validator(null), false)
    assert.equal(validator(12), false)
  }
})

test('actual consumers use the current native engines while original comparison identities remain independent', () => {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8')).packages
  for (const [name, version] of [
    ['ajv', '8.20.0+webops.2'],
    ['eslint', '10.14.0+webops.2'],
    ['postcss', '8.5.32+webops.1'],
    ['fast-uri', '4.2.3'],
    ['nanoid', '6.0.2'],
  ]) {
    const matches = Object.entries(lock).filter(([filename]) => filename.endsWith(`node_modules/${name}`))
    assert.ok(matches.length)
    for (const [filename, metadata] of matches)
      assert.equal(metadata.version, version, filename)
  }
  const lint = createRequire(current.resolve('eslint'))
  assert.equal(lint.resolve('ajv'), current.resolve('ajv'))
  const postcss = createRequire(current.resolve('postcss'))
  assert.equal(postcss.resolve('nanoid/non-secure'), current.resolve('nanoid/non-secure'))
  const originalLint = createRequire(original.resolve('eslint'))
  assert.equal(originalLint('ajv/package.json').version, '6.15.0')
  assert.equal(original('ajv/package.json').version, '8.20.0')
  assert.equal(original('nanoid/package.json').version, '3.3.20')
  assert.equal(original('fast-uri/package.json').version, '3.1.9')
})

const decisions = [
  {
    name: 'defaults, bounds, required fields and rejected extra properties',
    schema: {
      type: 'object',
      properties: {
        count: { type: 'integer', minimum: 1, maximum: 5 },
        mode: {
          enum: ['strict', 'reviewed'],
          default: 'strict',
        },
      },
      required: ['count'],
      additionalProperties: false,
    },
    valid: [
      { count: 1 },
      { count: 5, mode: 'reviewed' },
    ],
    invalid: [
      { count: 0 },
      { count: 6 },
      { count: '1' },
      {},
      { count: 1, extra: true },
    ],
  },
  {
    name: 'draft04 exclusive bounds and tuple cardinality',
    schema: {
      type: 'array',
      items: [
        { type: 'number', minimum: 0, exclusiveMinimum: true },
        { type: 'string', pattern: '^[a-z]+$' },
      ],
      minItems: 2,
      additionalItems: false,
    },
    valid: [
      [1, 'valid'],
    ],
    invalid: [
      [0, 'valid'],
      [1, 42],
      [1, 'valid', 'extra'],
      [],
    ],
  },
  {
    name: 'local references and data properties named nullable',
    schema: {
      definitions: {
        text: { type: 'string', nullable: true },
      },
      type: 'object',
      properties: {
        nullable: { $ref: '#/definitions/text' },
      },
      required: ['nullable'],
      additionalProperties: false,
    },
    valid: [
      { nullable: 'valid' },
    ],
    invalid: [
      { nullable: null },
      { nullable: 12 },
      {},
    ],
  },
  {
    name: 'references to annotation locations keep draft04 semantics',
    schema: {
      type: 'object',
      custom: {
        text: { type: 'string', nullable: true },
      },
      properties: {
        value: { $ref: '#/custom/text' },
      },
      required: ['value'],
    },
    valid: [
      { value: 'valid' },
    ],
    invalid: [
      { value: null },
      { value: false },
    ],
  },
]

for (const decision of decisions) {
  test(`real ESLint draft04 decisions preserve ${decision.name}`, () => {
    const oldValidator = factory(original)().compile(structuredClone(decision.schema))
    const currentValidator = factory(current)().compile(structuredClone(decision.schema))
    for (const [values, expected] of [
      [decision.valid, true],
      [decision.invalid, false],
    ]) {
      for (const value of values) {
        const before = structuredClone(value)
        const after = structuredClone(value)
        assert.equal(oldValidator(before), expected)
        assert.equal(currentValidator(after), expected)
        assert.deepEqual(after, before)
      }
    }
  })
}

test('native Ajv8 keeps its regular nullable support and a per-instance legacy policy', () => {
  const Ajv = current('ajv')
  const schema = { type: 'string', nullable: true }
  assert.equal(new Ajv().compile(schema)(null), true)
  assert.equal(new Ajv({ allowNullable: false }).compile(schema)(null), false)
  const draft04 = factory(current)()
  assert.equal(draft04.compile(schema)(null), false)
  assert.equal(factory(current)({ nullable: true }).compile(schema)(null), true)
  assert.deepEqual(schema, { type: 'string', nullable: true })
  assert.equal(new Ajv().compile(schema)(null), true)
})

test('draft04 nullable annotations preserve null types and literal defaults through references', () => {
  const schema = {
    type: 'object',
    definitions: {
      empty: { type: 'null', nullable: false },
    },
    properties: {
      empty: { $ref: '#/definitions/empty' },
      payload: {
        type: 'object',
        default: { nullable: true, type: 'literal-data' },
      },
    },
    required: ['empty'],
    additionalProperties: false,
  }
  for (const resolver of [original, current]) {
    const validate = factory(resolver)().compile(schema)
    const value = { empty: null }
    assert.equal(validate(value), true)
    assert.deepEqual(value, {
      empty: null,
      payload: { nullable: true, type: 'literal-data' },
    })
    assert.equal(validate({ empty: 'invalid' }), false)
    assert.equal(validate({}), false)
  }
  assert.deepEqual(schema.properties.payload.default, { nullable: true, type: 'literal-data' })
})

test('actual ESLint schema formats remain enabled rather than being skipped', () => {
  for (const [format, valid, invalid] of [
    ['email', 'synthetic@example.invalid', 'broken'],
    ['uri', 'https://example.invalid/path', 'relative'],
    ['ipv6', '2001:db8::1', '2001:::wrong'],
    ['uuid', '123e4567-e89b-12d3-a456-426614174000', 'invalid'],
  ]) {
    for (const resolver of [original, current]) {
      const validate = factory(resolver)().compile({ type: 'string', format })
      assert.equal(validate(valid), true, format)
      assert.equal(validate(invalid), false, format)
    }
  }
})

test('Fast URI4 resolves actual Ajv8 relative references and rejects mismatches', () => {
  const schema = {
    $id: 'https://example.invalid/schemas/root.json',
    type: 'object',
    definitions: {
      item: { $id: 'item.json', type: 'integer', minimum: 2 },
    },
    properties: {
      item: { $ref: 'item.json' },
    },
    required: ['item'],
    additionalProperties: false,
  }
  for (const resolver of [original, current]) {
    const Ajv = resolver('ajv')
    const validate = new Ajv().compile(structuredClone(schema))
    assert.equal(validate({ item: 2 }), true)
    assert.equal(validate({ item: 1 }), false)
    assert.equal(validate({ item: '2' }), false)
    assert.equal(validate({ item: 2, extra: true }), false)
  }
  assert.throws(() => factory(current)().compile({ $ref: 'https://example.invalid/never-requested.json' }), /resolve reference|MissingRef/)
})

test('PostCSS retains synchronous parsing, async plugins, locations and source maps with native NanoID6', async () => {
  const outputs = []
  for (const resolver of [original, current]) {
    const postcss = resolver('postcss')
    const parsed = postcss.parse('a { color: red }')
    assert.match(parsed.source.input.id, /^<input css [\w-]{6}>$/)
    const result = await postcss([
      {
        postcssPlugin: 'synthetic-color',
        async Declaration(declaration) {
          await Promise.resolve()
          if (declaration.prop === 'color')
            declaration.value = 'green'
        },
      },
    ]).process('a { color: red }', {
      from: 'synthetic-input.css',
      to: 'synthetic-output.css',
      map: { inline: false },
    })
    outputs.push({ css: result.css, sourcesContent: result.map.toJSON().sourcesContent, location: parsed.first.first.source.start })
    assert.throws(() => postcss.parse('a { color: red', { from: 'synthetic-input.css' }), error => error.name === 'CssSyntaxError' && error.line === 1 && error.column === 1)
  }
  assert.deepEqual(outputs[1], outputs[0])
  const { nanoid } = current('nanoid/non-secure')
  assert.match(nanoid(12), /^[\w-]{12}$/)
})

test('actual ESLint rejects invalid and formerly nullable rule options, preserves defaults and recovers', async () => {
  const { ESLint } = current('eslint')
  const rule = {
    meta: {
      type: 'problem',
      schema: [
        {
          type: 'object',
          properties: {
            value: { type: 'string', nullable: true, default: 'default-value' },
          },
          additionalProperties: false,
        },
      ],
      messages: { observed: 'Value {{value}}.' },
    },
    create(context) {
      return {
        Program(node) {
          context.report({
            node,
            messageId: 'observed',
            data: { value: context.options[0].value },
          })
        },
      }
    },
  }
  const make = options => new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ['**/*.js'],
        plugins: {
          synthetic: {
            rules: { options: rule },
          },
        },
        rules: {
          'synthetic/options': ['error', options],
        },
      },
    ],
  })
  await assert.rejects(make({ value: null }).lintText('const synthetic = 1', { filePath: 'synthetic.js' }), /must be string|should be string/)
  await assert.rejects(make({ extra: true }).lintText('const synthetic = 1', { filePath: 'synthetic.js' }), /Unexpected property "extra"/)
  const [result] = await make({}).lintText('const synthetic = 1', { filePath: 'synthetic.js' })
  assert.equal(result.messages[0].message, 'Value default-value.')
  assert.equal(result.messages[0].ruleId, 'synthetic/options')
})

test('the real maintained ESLint CLI reports ordinary rules and clean recovery', async (context) => {
  const directory = await temporary(context)
  const configuration = path.join(directory, 'eslint.config.mjs')
  const filename = path.join(directory, 'fixture.js')
  await writeFile(configuration, 'export default [{rules:{"no-debugger":"error"}}]\n')
  const argumentsList = [
    path.join(eslintDirectory(current), 'bin/eslint.js'),
    '--no-config-lookup',
    '--config',
    configuration,
    '--no-ignore',
    '--format',
    'json',
    filename,
  ]
  await writeFile(filename, 'debugger;\n')
  const rejected = spawnSync(process.execPath, argumentsList, { cwd: directory, encoding: 'utf8', timeout: 30000 })
  assert.equal(rejected.status, 1, rejected.stderr)
  assert.equal(JSON.parse(rejected.stdout)[0].messages[0].ruleId, 'no-debugger')
  await writeFile(filename, 'const syntheticValue = 1;\n')
  const accepted = spawnSync(process.execPath, argumentsList, { cwd: directory, encoding: 'utf8', timeout: 30000 })
  assert.equal(accepted.status, 0, accepted.stderr)
  assert.equal(JSON.parse(accepted.stdout)[0].errorCount, 0)
})

test('regenerated validator modules retain exact source content and mapped error locations', () => {
  const directory = path.dirname(current.resolve('ajv/package.json'))
  for (const filename of ['core', 'compile/validate/dataType', 'compile/validate/index']) {
    const source = readFileSync(path.join(directory, `lib/${filename}.ts`), 'utf8')
    const mapping = JSON.parse(readFileSync(path.join(directory, `dist/${filename}.js.map`), 'utf8'))
    assert.deepEqual(mapping.sourcesContent, [source])
    assert.equal(path.resolve(directory, 'dist', path.dirname(filename), mapping.sources[0]), path.join(directory, `lib/${filename}.ts`))
    assert.ok(mapping.mappings)
  }
  const filename = path.join(directory, 'lib/compile/validate/dataType.ts')
  const source = readFileSync(filename, 'utf8')
  const line = source.split('\n').findIndex(value => value.includes('throw new Error(\'"nullable" cannot')) + 1
  assert.ok(line > 0)
  const observed = spawnSync(process.execPath, ['--enable-source-maps', '-e', 'new (require("ajv"))().compile({nullable:true})'], { cwd: root, encoding: 'utf8', timeout: 30000 })
  assert.equal(observed.status, 1)
  assert.ok(observed.stderr.includes(`${filename}:${line}:`), observed.stderr)
})
