import path from 'node:path'
import { parse } from '@babel/parser'
import traverse from '@babel/traverse'
import { isIdentifier, isMemberExpression, isOptionalMemberExpression, isStringLiteral } from '@babel/types'
import { createFilter } from '@rollup/pluginutils'
import { MagicString } from 'magic-string'
import { createUnplugin } from 'unplugin'

const defaults = {
  external: [],
  consoleType: ['log'],
  include: [/\.[jt]sx?$/, /\.vue\??/],
  exclude: [/node_modules/, /\.git/],
}

export default createUnplugin((provided) => {
  const options = provided ?? defaults
  const filter = createFilter(
    options.include || [
      /\.[jt]sx?$/,
      /\.vue$/,
      /\.vue\?vue/,
      /\.svelte$/,
    ],
    options.exclude || [/[\\/]node_modules[\\/]/, /[\\/]\.git[\\/]/],
  )
  const external = new Set((options.external || []).map(filename => path.resolve(filename)))
  const methods = new Set(options.consoleType ?? ['log'])

  return {
    name: 'unplugin-remove-console-debugger',
    enforce: 'post',
    apply: 'build',
    transformInclude(id) {
      return filter(id)
    },
    transform(code, id) {
      if (external.has(path.resolve(id.split('?')[0])))
        return
      const typeScript = /\.tsx?(?:$|[?&])|[?&]lang[.=]tsx?(?:$|&)/.test(id)
      const plugins = typeScript
        ? ['typescript']
        : ['jsx']
      if (typeScript && /tsx(?:$|[?&])/.test(id))
        plugins.push('jsx')
      const ast = parse(code, { sourceType: 'unambiguous', sourceFilename: id, plugins })
      const editor = new MagicString(code)
      const removeStatement = statement => editor.overwrite(statement.start, statement.end, ';')
      const removeConsole = (current) => {
        const { callee } = current.node
        if (!(isMemberExpression(callee) || isOptionalMemberExpression(callee)))
          return
        if (!isIdentifier(callee.object, { name: 'console' }) || current.scope.getBinding('console'))
          return
        const name = callee.computed
          ? isStringLiteral(callee.property) && callee.property.value
          : isIdentifier(callee.property) && callee.property.name
        if (methods.has(name) && current.parentPath.isExpressionStatement()) {
          removeStatement(current.parentPath.node)
          current.skip()
        }
      }
      traverse(ast, {
        CallExpression: removeConsole,
        OptionalCallExpression: removeConsole,
        DebuggerStatement(current) {
          removeStatement(current.node)
        },
      })
      if (!editor.hasChanged())
        return
      return {
        code: editor.toString(),
        map: editor.generateMap({ source: id, includeContent: true, hires: true }),
      }
    },
  }
})
