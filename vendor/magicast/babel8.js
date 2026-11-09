import { generate } from '@babel/generator'
import { arrayExpression, bigIntLiteral, identifier, newExpression, objectExpression, objectProperty, regExpLiteral, valueToNode } from '@babel/types'

export const nativeLiteralBuilders = {
  arrayExpression,
  bigIntLiteral,
  identifier,
  literal: valueToNode,
  newExpression,
  objectExpression,
  property(kind, key, value) {
    if (kind !== 'init')
      throw new TypeError('Literal object properties must be initializers')
    return objectProperty(key, value)
  },
  regExpLiteral,
}

export function extendBabel8Types(types) {
  const { Type } = types
  const define = Type.def
  const either = Type.or
  const absent = () => null
  const entityName = either(define('Identifier'), define('TSQualifiedName'))
  const argumentsType = either(define('TSTypeParameterInstantiation'), null)
  const annotation = either(define('TSTypeAnnotation'), null)
  const parameters = [
    either(define('Identifier'), define('RestElement'), define('ArrayPattern'), define('ObjectPattern')),
  ]
  const bigint = Type.from(value => typeof value === 'bigint', 'bigint')
  define('BigIntLiteral').field('value', bigint).field('extra', either({ rawValue: bigint, raw: String }, null), absent)
  define('ImportExpression').field('options', either(define('Expression'), null), absent).field('phase', either('source', 'defer', null), absent).field('sync', either(Boolean, null), absent)
  define('ImportDeclaration').field('phase', either('source', 'defer', null), absent)
  define('TSEnumBody').bases('Node').build('members').field('members', [
    define('TSEnumMember'),
  ])
  for (const name of ['TSClassImplements', 'TSInterfaceHeritage']) {
    define(name).bases('TSType').build('expression', 'typeArguments').field('expression', entityName).field('typeArguments', argumentsType, absent)
  }
  define('TSTemplateLiteralType').bases('TSType').build('quasis', 'types').field('quasis', [
    define('TemplateElement'),
  ]).field('types', [
    define('TSType'),
  ])
  for (const name of [
    'CallExpression',
    'OptionalCallExpression',
    'NewExpression',
    'JSXOpeningElement',
    'TSImportType',
    'TSInstantiationExpression',
    'TSTypeQuery',
    'TSTypeReference',
  ]) {
    const definition = define(name)
    definition.field('typeParameters', null, absent, true).field('typeArguments', argumentsType, absent)
    definition.buildParams = definition.buildParams.map(field => field === 'typeParameters'
      ? 'typeArguments'
      : field)
  }
  for (const name of ['ClassDeclaration', 'ClassExpression']) {
    define(name).field('superTypeParameters', null, absent, true).field('superTypeArguments', argumentsType, absent).field('implements', either([
      define('TSClassImplements'),
    ], [
      define('ClassImplements'),
    ], null), absent)
  }
  for (const name of [
    'TSCallSignatureDeclaration',
    'TSConstructSignatureDeclaration',
    'TSFunctionType',
    'TSConstructorType',
    'TSMethodSignature',
  ]) {
    const definition = define(name)
    definition.field('parameters', null, absent, true).field('typeAnnotation', null, absent, true).field('params', parameters).field('returnType', annotation, absent)
    definition.buildParams = definition.buildParams.map(field => field === 'parameters'
      ? 'params'
      : field === 'typeAnnotation'
        ? 'returnType'
        : field)
  }
  define('TSTypeParameter').field('name', define('Identifier')).field('in', either(Boolean, null), absent).field('out', either(Boolean, null), absent).field('const', either(Boolean, null), absent)
  define('TSMappedType').field('typeParameter', null, absent, true).field('key', define('Identifier')).field('constraint', define('TSType')).field('nameType', either(define('TSType'), null), absent)
  define('TSMappedType').buildParams = ['key', 'constraint', 'typeAnnotation']
  define('TSTypeQuery').field('exprName', either(entityName, define('TSImportType'), define('ThisExpression')))
  define('TSEnumDeclaration').field('members', null, absent, true).field('body', define('TSEnumBody'))
  define('TSEnumDeclaration').buildParams = ['id', 'body']
  define('TSImportType').field('argument', null, absent, true).field('source', define('StringLiteral')).field('options', either(define('ObjectExpression'), null), absent)
  define('TSImportType').buildParams = ['source', 'qualifier', 'typeArguments']
  define('TSInterfaceDeclaration').field('extends', either([
    define('TSInterfaceHeritage'),
  ], null), absent)
  define('TSModuleDeclaration').field('kind', either('global', 'module', 'namespace'))
  define('TSImportEqualsDeclaration').field('isExport', null, absent, true).field('importKind', either('type', 'value'), () => 'value')
}

export function printBabel8Node(node, options) {
  if (['TSTypeAnnotation', 'TSTypeParameterDeclaration', 'TSTypeParameterInstantiation'].includes(node.type))
    return null
  if (!node.type.startsWith('TS') && node.type !== 'ImportExpression' && !node.typeArguments && !node.superTypeArguments)
    return null
  const printable = {
    ...node,
    leadingComments: undefined,
    trailingComments: undefined,
    decorators: undefined,
  }
  return generate(printable, {
    comments: true,
    jsescOption: {
      quotes: options.quote === 'single'
        ? 'single'
        : 'double',
    },
  }).code
}
