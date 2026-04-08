const fs = require('node:fs')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '..')
const outputRoot = process.env.TARO_OUTPUT_ROOT || 'dist'
const sourceConfigPath = path.join(projectRoot, 'project.config.json')
const outputConfigPath = path.join(projectRoot, outputRoot, 'project.config.json')

if (!fs.existsSync(sourceConfigPath) || !fs.existsSync(path.join(projectRoot, outputRoot))) {
  process.exit(0)
}

const config = JSON.parse(fs.readFileSync(sourceConfigPath, 'utf8'))
const outputConfig = {
  ...config,
  miniprogramRoot: './'
}

fs.writeFileSync(outputConfigPath, `${JSON.stringify(outputConfig, null, 2)}\n`, 'utf8')
console.log(`synced weapp project config -> ${outputConfigPath}`)
