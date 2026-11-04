import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({
	ignores: ['pkg/**', 'node_modules/**', 'doc/**', 'tools/**', '.claude/**'],
})

export default [
	...baseConfig,
	{
		files: ['test/**/*.js'],
		rules: {
			// node:test uses top-level describe/it via require, no globals needed
		},
	},
]
