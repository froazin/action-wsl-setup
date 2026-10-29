// Entry point that ncc bundles into dist/index.js. action.yml runs it as the main step and again
// as the post step, and the saved is-post state tells the two apart.
import * as core from '@actions/core'
import { post, run } from './main.js'

if (core.getState('is-post') === 'true') {
  post()
} else {
  core.saveState('is-post', 'true')
  await run()
}
