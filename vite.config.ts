import { defineConfig, loadEnv } from 'vite'
import { resolve, join } from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  let basePath;
  if(env["GITHUB_ACTIONS"] === "true") {
    basePath = "/" + env["GITHUB_REPOSITORY"].split("/")[1]
  } else {
    basePath = "/"
  }
  return {
    base: basePath,
  }
})
